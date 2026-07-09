# Monitor Architecture

The monitor is a layered discovery and normalization pipeline.

1. `config.mjs` owns runtime settings and shared matching patterns.
2. `discovery.mjs` identifies structured sources from official career URLs and caches the result.
3. `adapters/providers.mjs` fetches provider APIs, while `adapters/html.mjs` handles official HTML, JSON-LD, and sitemaps. `adapters/registry.mjs` dispatches sources without embedding provider logic.
4. `domain.mjs` applies role, degree, graduation-window, location, category, compensation, and deduplication rules.
5. `output.mjs` merges current roles and renders JSON, CSV, and README output.
6. `monitor_company_roles.mjs` coordinates those modules and contains no provider parsing.

## Source Order

The monitor prefers sources in this order:

1. Curated official ATS configuration
2. Automatically recognized official ATS links or redirects
3. `JobPosting` JSON-LD on official detail pages
4. Official job URLs declared through robots and sitemaps
5. A curated adapter for sites without a stable public machine-readable surface

Discovery is cached because ATS vendors and career-site topology change much less frequently than job postings. Discovered structured sources are scanned on every monitor run, while topology is refreshed weekly and failed discoveries retry sooner. The scheduled batch is bounded so a wave of slow career sites cannot consume the whole workflow window.

The monitor never bypasses access controls. A `robots.txt` disallow is recorded as blocked, and unreachable robots policy prevents discovery until it can be checked safely.
