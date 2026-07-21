# Monitor Architecture

The monitor is a layered discovery and normalization pipeline.

1. `config.mjs` owns runtime settings and shared matching patterns.
2. `discovery.mjs` identifies structured sources from official career URLs and caches the result.
3. `adapters/providers.mjs` fetches provider APIs, while `adapters/html.mjs` handles official HTML, JSON-LD, and sitemaps. `adapters/registry.mjs` dispatches sources without embedding provider logic.
4. `feed_discovery.mjs` reads broad 2027 JSON/Markdown lists as secondary discovery seeds, rejects aggregator links and ineligible rows, and verifies unseen direct employer/ATS pages before publication.
5. `domain.mjs` applies role, degree, graduation-window, location, category, compensation, and deduplication rules.
6. `lifecycle.mjs` attributes roles to sources, rejects confirmed closed or expired postings, and preserves roles when a source fails or cannot prove closure.
7. `output.mjs` preserves first-seen history, merges current roles, sorts each board section newest-first, and renders JSON, CSV, a compact README dashboard, and separate new-grad and internship boards.
8. `monitor_company_roles.mjs` coordinates those modules and contains no provider parsing.

Secondary-feed rows are published only after an official requisition check. The verifier uses provider APIs for recognized Ashby, Greenhouse, Lever, and Workday URLs, detects soft 404 redirects on other sites, and periodically revalidates cached rows. A feed listing alone is never treated as proof that a role remains open.

## Source Order

The monitor prefers sources in this order:

1. Curated official ATS configuration
2. Automatically recognized official ATS links or redirects
3. `JobPosting` JSON-LD on official detail pages
4. Official job URLs declared through robots and sitemaps
5. A curated adapter for sites without a stable public machine-readable surface
6. Curated 2027 lists as discovery-only seeds, followed by direct official-page verification

Discovery is cached because ATS vendors and career-site topology change much less frequently than job postings. Discovered structured sources are scanned on every monitor run, while topology is refreshed weekly and failed discoveries retry sooner. The scheduled batch is bounded so a wave of slow career sites cannot consume the whole workflow window.

The monitor never bypasses access controls. A `robots.txt` disallow is recorded as blocked, and unreachable robots policy prevents discovery until it can be checked safely.

Community lists never become the application source shown to users. Their rows must resolve to direct company or ATS job URLs; known aggregators and URL shorteners are rejected, new links are fetched to confirm they are live, and the official adapter wins when both paths find the same role. Feed provenance and verification status remain in the JSON/CSV data for auditing.

## Role Lifecycle

`date_seen` is immutable and records when this tracker first discovered a role. `posted_at` is the company's publication date when the source exposes one, and `last_seen` is the latest successful verification date. The public board displays posting and first-seen dates separately and sorts by `posted_at`, falling back to `date_seen`.

Greenhouse, Lever, Ashby, and Tesla provide complete public listing snapshots, so a role missing from a successful scan is removed immediately. Search-based and HTML sources are partial: a missing role is removed only when its detail page explicitly reports closure, returns 404/410, exposes an expired `validThrough`, or remains unseen past the stale window. Failed and blocked scans never remove roles.
