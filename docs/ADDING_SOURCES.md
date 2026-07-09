# Adding Official Job Sources

Prefer structured ATS adapters when a company uses a known provider:

- `greenhouse`
- `lever`
- `ashby`
- `workday`
- `phenom`
- `avature`
- `tesla`

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

Run this before opening a PR:

```bash
npm run validate
npm run monitor
```
