import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  canonicalApplyUrl,
  extractCompensation,
  isAllowedLocation,
  isEligibleRole,
  isRelevant,
  keyFor,
  normalizePostingDate,
} from "./domain.mjs";
import { htmlJobFromDetail, htmlJobToLead, htmlJobUrl } from "./adapters.mjs";
import { readJson, validateConfiguration } from "./http.mjs";
import {
  compareRoles,
  csvEscape,
  normalizedErrorCategory,
  renderRoleDates,
  toPublicRole,
} from "./output.mjs";
import { closedPageReason, reconcileRoleLifecycle } from "./lifecycle.mjs";
import {
  detectAtsSource,
  detectAtsSources,
  parseRobotsTxt,
  parseSitemapXml,
  robotsAllows,
} from "./discovery.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(__dirname, "..", "..", "data");
const targetPath = path.join(dataDir, "company_sources.json");
const sourcePath = path.join(dataDir, "ats_sources.json");

export function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

export function assertTruthy(value, label) {
  if (!value) throw new Error(`${label}: expected truthy value`);
}

export function assertThrows(callback, pattern, label) {
  try {
    callback();
  } catch (error) {
    if (pattern.test(error.message)) return;
    throw new Error(`${label}: threw unexpected error ${JSON.stringify(error.message)}`);
  }
  throw new Error(`${label}: expected callback to throw`);
}

export async function runSelfTests() {
  const encodedSalary = `
    &lt;div class=&quot;content-pay-transparency&quot;&gt;
      &lt;div class=&quot;title&quot;&gt;US Salary Range&lt;/div&gt;
      &lt;div class=&quot;pay-range&quot;&gt;
        &lt;span&gt;$86,000&lt;/span&gt;
        &lt;span class=&quot;divider&quot;&gt;&amp;mdash;&lt;/span&gt;
        &lt;span&gt;$114,000 USD&lt;/span&gt;
      &lt;/div&gt;
    &lt;/div&gt;`;
  assertEqual(
    extractCompensation("2027 Early Career Mechanical Engineer", encodedSalary),
    "$86,000 - $114,000 USD",
    "encoded salary range",
  );
  assertEqual(
    extractCompensation("Graduate Software Engineer", "The salary for this role is $200,000."),
    "$200,000",
    "single annual salary",
  );
  assertEqual(
    extractCompensation("Software Engineer II, Early Career", "US: $123000 - $175000 (USD) + 15% bonus target + equity + benefits"),
    "$123,000 - $175,000 USD",
    "uncommaed annual salary range",
  );
  assertEqual(
    extractCompensation("Electrical Engineer Intern - Summer 2027", "US Salary Range $30 - $45 USD"),
    "$30 - $45/hr USD",
    "intern hourly range without hour suffix",
  );
  assertEqual(
    extractCompensation("Quant Research Intern - Summer 2027", "Salary Range: $5,000 - $5,300 weekly"),
    "$5,000 - $5,300/week",
    "weekly internship compensation",
  );
  assertEqual(
    extractCompensation("Software Engineer Intern - Summer 2027", {
      jobPostingInfo: {
        baseSalary: {
          currency: "USD",
          value: { minValue: 32, maxValue: 48, unitText: "HOUR" },
        },
      },
    }),
    "$32 - $48/hr",
    "nested structured hourly compensation",
  );
  assertEqual(
    isEligibleRole("[2026] Senior Machine Learning Engineer - PhD Early Career", ""),
    false,
    "senior early-career false positive",
  );
  assertEqual(
    isEligibleRole("Software Engineer, PhD, Early Career, AI/Machine Learning, 2026 Start", ""),
    false,
    "2026 start false positive",
  );
  assertEqual(
    isEligibleRole("Software Engineer, Systems Research, PhD, Early Career", ""),
    false,
    "PhD early-career false positive",
  );
  assertEqual(
    isEligibleRole("Graduate Quantitative Researcher (BS/MS)", ""),
    false,
    "BS/MS graduate false positive",
  );
  assertEqual(
    isEligibleRole("Quantitative Research Intern (PhD) - Summer 2027", ""),
    false,
    "PhD internship false positive",
  );
  assertEqual(
    isEligibleRole("Software Engineer, MS New Graduate", ""),
    false,
    "MS new-grad false positive",
  );
  assertEqual(
    isEligibleRole("Software Engineer II, Early Career, Google Cloud AI Career Catalyst Program", "Ability to start in June 2027."),
    true,
    "early career with 2027 start",
  );
  assertEqual(
    isEligibleRole("Software Engineer, New Grad", "Master's degree preferred."),
    true,
    "masters preference does not exclude bachelors role",
  );
  assertEqual(
    isRelevant("Account Executive, Early Career", "Works with software engineers and data systems."),
    false,
    "role relevance is determined by the title",
  );
  assertEqual(isAllowedLocation({ location: "New York, NY" }), true, "US state location");
  assertEqual(isAllowedLocation({ location: "Remote - United States" }), true, "US remote location");
  assertEqual(isAllowedLocation({ location: "Remote" }), false, "ambiguous remote location");
  assertEqual(isAllowedLocation({ location: "London, United Kingdom" }), false, "foreign location");
  assertEqual(isAllowedLocation({ location: "Washington, United Kingdom" }), false, "foreign city named like US state");
  assertEqual(isAllowedLocation({ location: "Toronto, Canada; New York, NY" }), true, "multi-location role with US option");
  assertEqual(
    canonicalApplyUrl("https://example.com/jobs/123/?utm_source=test&ref=friend#apply"),
    "https://example.com/jobs/123",
    "tracking URL canonicalization",
  );
  assertEqual(
    keyFor("Example", "Engineer", "Texas", "https://careers.example.com/ca/fr/job/1206917/Engineer"),
    keyFor("Example", "Engineer", "Texas", "https://careers.example.com/us/en/job/1206917/Engineer"),
    "localized requisition URL identity",
  );
  assertEqual(csvEscape("=HYPERLINK(\"bad\")"), "\"'=HYPERLINK(\"\"bad\"\")\"", "CSV formula neutralization");
  assertEqual(normalizedErrorCategory("404 NOT FOUND"), "404 Not Found", "stable HTTP error category");
  assertEqual(normalizePostingDate("Posted 3 Days Ago", "2026-07-13T12:00:00Z"), "2026-07-10", "relative posting date");
  assertEqual(normalizePostingDate("Posted Today", "2026-07-14T02:00:00Z"), "2026-07-13", "relative posting date uses board timezone");
  assertEqual(normalizePostingDate("Posted 30+ Days Ago", "2026-07-13T12:00:00Z"), "", "ambiguous relative posting date");
  const preservedRole = toPublicRole({
    company: "Example",
    title: "Software Engineer, New Grad",
    location: "Austin, TX",
    url: "https://example.com/jobs/12345",
    date_seen: "2026-07-05",
    last_seen: "2026-07-10",
  }, "2026-07-13T12:00:00Z", { seenNow: false });
  assertEqual(preservedRole.date_seen, "2026-07-05", "first seen is immutable during normalization");
  assertEqual(preservedRole.last_seen, "2026-07-10", "last seen is preserved when role was not observed");
  assertEqual(
    compareRoles(
      { role_type: "New Grad", discipline: "Software / AI / ML", company: "Older", title: "Engineer", location: "TX", posted_at: "2026-07-01", date_seen: "2026-07-10" },
      { role_type: "New Grad", discipline: "Software / AI / ML", company: "Newer", title: "Engineer", location: "TX", posted_at: "2026-07-12", date_seen: "2026-07-12" },
    ) > 0,
    true,
    "newest posting sorts first",
  );
  assertEqual(renderRoleDates({ posted_at: "2026-07-01", date_seen: "2026-07-05" }), "Posted Jul 1, 2026<br>First seen Jul 5, 2026", "posted and first-seen labels");
  assertEqual(closedPageReason(200, "This job is no longer available", "2026-07-13"), "explicit closed-page message", "closed page message");
  assertEqual(closedPageReason(200, '<script>{"validThrough":"2026-07-01"}</script>', "2026-07-13"), "expired on 2026-07-01", "expired structured posting");
  const lifecycleRole = {
    company: "Example",
    title: "Software Engineer, New Grad",
    location: "Austin, TX",
    url: "https://boards.greenhouse.io/example/jobs/12345",
    date_seen: "2026-07-05",
  };
  const lifecycle = await reconcileRoleLifecycle(
    [lifecycleRole],
    [],
    [{ source: { company: "Example", adapter: "greenhouse" }, leads: [], log: { status: "ok" } }],
    "2026-07-13T12:00:00Z",
  );
  assertEqual(lifecycle.roles.length, 0, "authoritative source removes missing role");
  const failedLifecycle = await reconcileRoleLifecycle(
    [lifecycleRole],
    [],
    [{ source: { company: "Example", adapter: "greenhouse" }, leads: [], log: { status: "error" } }],
    "2026-07-13T12:00:00Z",
  );
  assertEqual(failedLifecycle.roles.length, 1, "failed source preserves role");
  assertEqual(htmlJobUrl({}, "https://example.com/jobs", "https://[invalid"), "", "invalid HTML link isolation");
  const robots = parseRobotsTxt("User-agent: *\nDisallow: /private/\nAllow: /private/jobs/\nSitemap: https://example.com/jobs.xml");
  assertEqual(robotsAllows("https://example.com/private/profile", robots), false, "robots disallow");
  assertEqual(robotsAllows("https://example.com/private/jobs/123", robots), true, "robots longest allow");
  assertEqual(robots.sitemaps[0], "https://example.com/jobs.xml", "robots sitemap");
  assertEqual(
    parseSitemapXml("<urlset><url><loc>https://example.com/jobs/123</loc><lastmod>2026-07-01</lastmod></url></urlset>")[0].loc,
    "https://example.com/jobs/123",
    "sitemap URL parsing",
  );
  assertEqual(
    detectAtsSource(
      { company: "Example", career_url: "https://example.com/careers", priority: "P1" },
      ["https://example.wd5.myworkdayjobs.com/External/job/Austin/Software-Engineer_R1"],
    ).adapter,
    "workday",
    "Workday source fingerprint",
  );
  assertEqual(
    detectAtsSources(
      { company: "Example", career_url: "https://example.com/careers", priority: "P1" },
      ["https://example.wd5.myworkdayjobs.com/en-US/Example_Careers/job/Austin/Software-Engineer_R1"],
    )[0].site,
    "Example_Careers",
    "localized Workday site fingerprint",
  );
  assertEqual(
    detectAtsSource(
      { company: "Example", career_url: "https://example.com/careers", priority: "P1" },
      ["https://boards.greenhouse.io/example/jobs/123"],
    ).board,
    "example",
    "Greenhouse source fingerprint",
  );
  assertThrows(
    () => validateConfiguration(
      [{ company: "Example", career_url: "https://example.com/careers", priority: "P1" }],
      [{ company: "Example", adapter: "mystery" }],
    ),
    /unsupported/,
    "unknown adapter validation",
  );

  const htmlFixture = `
    <html><head>
      <title>Software Engineer, Early Career - Example Careers</title>
      <meta property="og:title" content="Software Engineer, Early Career - Example Careers">
      <script type="application/ld+json">
        {
          "@context": "https://schema.org",
          "@type": "JobPosting",
          "title": "Software Engineer, Early Career",
          "description": "<p>Ability to start in June 2027.</p>",
          "jobLocation": {
            "@type": "Place",
            "address": {
              "@type": "PostalAddress",
              "addressLocality": "Austin",
              "addressRegion": "TX",
              "addressCountry": "US"
            }
          },
          "baseSalary": {
            "@type": "MonetaryAmount",
            "currency": "USD",
            "value": {
              "@type": "QuantitativeValue",
              "minValue": 90000,
              "maxValue": 120000,
              "unitText": "YEAR"
            }
          }
        }
      </script>
    </head><body><main><h3>Minimum qualifications:</h3><p>Ability to start in June 2027.</p></main></body></html>`;
  const htmlSource = { company: "Example", priority: "P0", titleSuffixPattern: "\\s+-\\s+Example Careers$" };
  const parsedJob = htmlJobFromDetail(htmlSource, "https://example.com/jobs/123", htmlFixture);
  assertEqual(parsedJob.title, "Software Engineer, Early Career", "html job title");
  assertEqual(parsedJob.location, "Austin, TX, US", "html structured location");
  const lead = htmlJobToLead(htmlSource, parsedJob);
  assertEqual(lead.compensation, "$90,000 - $120,000", "html structured compensation");
  assertTruthy(isEligibleRole(lead.role_title, parsedJob.description), "html job eligibility");

  validateConfiguration(
    await readJson(targetPath, []),
    await readJson(sourcePath, []),
  );
}

await runSelfTests();
console.log("monitor self-test ok");
