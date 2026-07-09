# Adding Official Job Sources

Prefer structured ATS adapters when a company uses a known provider:

- `greenhouse`
- `lever`
- `ashby`
- `workday`
- `phenom`
- `avature`
- `tesla`

The monitor validates every source at startup. A source must reference a company in `data/company_sources.json`, use a supported adapter, and include that adapter's required fields. Invalid URLs, regular expressions, limits, timeouts, priorities, and duplicate sources fail validation instead of silently producing zero roles.

Search-based adapters (`workday`, `phenom`, and `avature`) automatically query the tracked disciplines plus new-grad, early-career, internship, hardware, and quantitative terms. Set `searchTexts` to a non-empty string array when a source needs a custom query set. Workday sources also support `maxPages` and detail-page enrichment.

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

Public rows are restricted to unambiguous United States locations. Generic `Remote` locations are intentionally excluded unless the posting identifies them as US remote. Roles whose titles target master's, PhD, or mixed BS/MS programs are also excluded; a normal bachelor's role is not excluded merely because its description says a graduate degree is preferred.

Useful runtime controls include `ATS_SOURCE_CONCURRENCY`, `DIRECT_PAGE_CONCURRENCY`, `HTML_DETAIL_CONCURRENCY`, `FETCH_TIMEOUT_MS`, `FETCH_RETRIES`, and `MIN_ATS_SUCCESS_PERCENT`. Invalid values fail immediately. The scheduled workflow requires at least a 75% successful structured-source scan so a broad outage cannot look like a healthy update.

Run this before opening a PR:

```bash
npm run validate
npm run monitor
```
