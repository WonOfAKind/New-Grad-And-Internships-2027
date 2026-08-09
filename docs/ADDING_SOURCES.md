# Adding Official Job Sources

Prefer structured ATS adapters when a company uses a known provider:

- `greenhouse`
- `lever`
- `ashby`
- `workday`
- `phenom`
- `avature`
- `tesla`
- `sitemap_jobs`

The monitor validates every source at startup. A source must reference a company in `data/company_sources.json`, use a supported adapter, and include that adapter's required fields. Invalid URLs, regular expressions, limits, timeouts, priorities, and duplicate sources fail validation instead of silently producing zero roles.

Search-based adapters (`workday`, `phenom`, and `avature`) automatically query the tracked disciplines plus new-grad, early-career, internship, hardware, mechanical, aerospace, manufacturing, product-management, and quantitative terms. Set `searchTexts` to a non-empty string array when a source needs a custom query set. Workday sources also support `maxPages` and detail-page enrichment.

When adding employers, set `role_families` broadly enough to reflect what the company actually hires. Canonical names, aliases, parent companies, featured designations, and recommendation-list membership belong in `data/company_metadata.json`, not in rendering code. See `docs/DISCIPLINE_COVERAGE.md` for the maintained title vocabulary and employer cohorts.

Most companies should not require a hand-written source. The discovery layer inspects the official career URL, follows redirects, recognizes Greenhouse, Lever, Ashby, Workday, and Avature fingerprints, reads `JobPosting` JSON-LD, and checks declared job sitemaps while honoring `robots.txt`. Results are cached in `data/source_discovery.json` and promoted to runtime sources automatically.

Add a curated source only when the official site does not expose a supported machine-readable surface or when its public integration needs stable provider-specific parameters.

For official company pages that expose job detail pages but do not use one of those adapters, use `html_jobs` in `data/ats_sources.json`.

## `html_jobs`

Use this adapter for official search pages or hand-seeded official job URLs. It can parse:

- standard HTML title, `h1`, and meta tags
- JSON-LD `JobPosting` schema
- search-result links that match configured detail URL patterns
- visible compensation text with dollar signs or `USD`
- structured `baseSalary` JSON-LD fields

Example:

```json
{
  "company": "Example",
  "adapter": "html_jobs",
  "urls": [
    "https://example.com/careers/jobs?q=early%20career",
    "https://example.com/careers/jobs/software-engineer-early-career"
  ],
  "detailUrlPatterns": [
    "/careers/jobs/"
  ],
  "contentStartPattern": "<h[1-4][^>]*>\\s*(?:Minimum qualifications|Requirements|About the role)",
  "titleSuffixPattern": "\\s+-\\s+Example Careers$",
  "detailLimit": 8,
  "timeoutMs": 30000,
  "priority": "P0"
}
```

Only use official company or ATS URLs. Avoid unofficial GitHub lists as primary sources.

## Secondary discovery feeds

`data/discovery_feeds.json` may contain curated 2027 lists in JSON or Markdown-table form. These feeds improve breadth but never replace official sources: the parser extracts a direct employer/ATS job link, rejects aggregator and redirect hosts, applies BS/2027/discipline rules, and verifies unseen official pages before a row can appear. Keep the feed's public repository in `homepage` so provenance is auditable.

Use discovery feeds for finding leads across companies that are not yet in `company_sources.json`. Add a normal official ATS source whenever one is discoverable; official adapter data takes precedence over feed metadata.

Public rows are restricted to unambiguous United States locations. Generic `Remote` locations are intentionally excluded unless the posting identifies them as US remote. Roles whose titles target master's, PhD, or mixed BS/MS programs are also excluded; a normal bachelor's role is not excluded merely because its description says a graduate degree is preferred.

Useful runtime controls include `ATS_SOURCE_CONCURRENCY`, `HTML_DETAIL_CONCURRENCY`, `DISCOVERY_CONCURRENCY`, `DISCOVERY_LIMIT`, `DISCOVERY_REFRESH_HOURS`, `DISCOVERY_FEED_CONCURRENCY`, `DISCOVERY_FEED_VERIFY_LIMIT`, `DISCOVERY_FEED_TIMEOUT_MS`, `DISCOVERY_FEED_REVERIFY_HOURS`, `SITEMAP_DETAIL_LIMIT`, `FETCH_TIMEOUT_MS`, `FETCH_RETRIES`, and `MIN_ATS_SUCCESS_PERCENT`. Invalid values fail immediately. The scheduled workflow requires at least a 75% successful curated-source scan so a broad outage cannot look like a healthy update.

Run this before opening a PR:

```bash
npm run validate
npm run discover
npm run monitor
```
