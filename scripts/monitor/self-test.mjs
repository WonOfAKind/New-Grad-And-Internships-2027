import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  canonicalApplyUrl,
  extractCompensation,
  isAllowedLocation,
  isEligibleRole,
  isDirectEmployerApplyUrl,
  isFreshEnough,
  isRelevant,
  keyFor,
  normalizePostingDate,
  normalizeCompanyName,
  normalizeDisplayText,
  normalizeRoleTitle,
} from "./domain.mjs";
import { htmlJobFromDetail, htmlJobToLead, htmlJobUrl } from "./adapters.mjs";
import { readJson, validateConfiguration } from "./http.mjs";
import {
  compareRoles,
  csvEscape,
  normalizedErrorCategory,
  renderReadme,
  renderRoleDates,
  renderRolePage,
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
import {
  applyUrlFromFeedRow,
  discoverySeedRejection,
  humanApplyUrl,
  isOfficialJobUrl,
  parseJsonFeed,
  parseMarkdownFeed,
  validateDiscoveryFeeds,
} from "./feed_discovery.mjs";

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
    isEligibleRole("Campus AI Research Engineer (Intern)", "2027 internship cycle\nUndergrad"),
    true,
    "trusted 2027 discovery season makes generic internship eligible",
  );
  assertEqual(isRelevant("FPGA Engineer Intern"), true, "hardware internship title coverage");
  assertEqual(isRelevant("Network Engineer Internship"), true, "network internship title coverage");
  assertEqual(isRelevant("Design Engineer Co-op"), false, "generic design role is outside tracked disciplines");
  assertEqual(isRelevant("Intern - UI/UX Researcher - Human Factor Engineer"), false, "generic UX research role is outside tracked disciplines");
  assertEqual(isRelevant("Co-Op, Software Product Management"), false, "product management role is outside tracked disciplines");
  assertEqual(isRelevant("AI Operations Intern"), false, "non-engineering operations role is outside tracked disciplines");
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
    isEligibleRole("Software Engineer, New College Grad - 2026", "2027 new grad recruiting cycle"),
    false,
    "explicit title year overrides inferred source season",
  );
  assertEqual(
    isFreshEnough({ company: "Example", title: "Software Engineering Intern, Summ...", location: "Austin, TX", url: "https://example.com/jobs/123", grad_window: "2027 internship cycle" }),
    false,
    "truncated public title rejected",
  );
  assertEqual(
    isFreshEnough({ company: "Example", title: "Data Analytics Intern", location: "Austin, TX", url: "https://example.com/jobs/data-analytics-intern-fall-2026-123", grad_window: "2027 internship cycle" }),
    false,
    "official URL year overrides inferred source season",
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
  assertEqual(isAllowedLocation({ location: "Toronto, Ontario, CA" }), false, "Canadian CA abbreviation is not California");
  assertEqual(isDirectEmployerApplyUrl("https://app.ripplematch.com/v2/public/job/abc123"), false, "matching platform URL rejected");
  assertEqual(isDirectEmployerApplyUrl("https://jobs.ashbyhq.com/example/123456"), true, "official ATS URL accepted");
  assertEqual(normalizeCompanyName("Copart ✓"), "Copart", "source status marker removed from company name");
  assertEqual(normalizeCompanyName("IMC"), "IMC Trading", "company alias normalized");
  assertEqual(normalizeCompanyName("Tower Research"), "Tower Research Capital", "company legal-name alias normalized");
  assertEqual(normalizeCompanyName("Susquehanna"), "Susquehanna International Group", "company short-name alias normalized");
  assertEqual(normalizeRoleTitle("Intern, Software Engineering 🆕"), "Intern, Software Engineering", "source marker removed from title");
  assertEqual(normalizeRoleTitle("Avionics Software Intern 🇺🇸"), "Avionics Software Intern", "country marker removed from title");
  assertEqual(normalizeDisplayText("R&amp;D &quot;Systems&quot;"), 'R&D "Systems"', "display entities decoded");
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
  const boardRoles = [
    {
      company: "Example",
      title: "Software Engineer, New Grad",
      location: "Austin, TX",
      compensation: "$100,000",
      grad_window: "2027 new grad recruiting cycle",
      role_type: "New Grad",
      discipline: "Software / AI / ML",
      posted_at: "2026-07-12",
      date_seen: "2026-07-13",
      url: "https://example.com/jobs/new-grad",
    },
    {
      company: "Example",
      title: "Software Engineer Intern",
      location: "Austin, TX",
      compensation: "$50/hour",
      grad_window: "Summer 2027",
      role_type: "Internship",
      discipline: "Software / AI / ML",
      posted_at: "2026-07-11",
      date_seen: "2026-07-13",
      url: "https://example.com/jobs/intern",
    },
  ];
  const boardCoverage = { scanned_at: "2026-07-13T12:00:00Z", companies_in_target_list: 1, discovery_feeds: {} };
  const readme = renderReadme(boardRoles, boardCoverage, 2);
  assertTruthy(readme.includes("[New Grad Roles](NEW_GRAD.md): 1 roles"), "README links to new-grad board");
  assertTruthy(readme.includes("[Internship Roles](INTERNSHIPS.md): 1 roles"), "README links to internship board");
  assertEqual(readme.includes("| Company | Role |"), false, "README does not embed role tables");
  const newGradBoard = renderRolePage(boardRoles, boardCoverage, "New Grad");
  assertTruthy(newGradBoard.includes("Software Engineer, New Grad"), "new-grad board contains new-grad role");
  assertEqual(newGradBoard.includes("Software Engineer Intern"), false, "new-grad board excludes internship role");
  const internshipBoard = renderRolePage(boardRoles, boardCoverage, "Internship");
  assertTruthy(internshipBoard.includes("Software Engineer Intern"), "internship board contains internship role");
  assertEqual(internshipBoard.includes("Software Engineer, New Grad"), false, "internship board excludes new-grad role");
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
  const feed = {
    name: "Fixture 2027 Internships",
    url: "https://raw.githubusercontent.com/example/list/main/README.md",
    homepage: "https://github.com/example/list",
    format: "markdown",
    season_hint: "2027 internship cycle",
  };
  validateDiscoveryFeeds([feed]);
  assertThrows(() => validateDiscoveryFeeds([{ ...feed, season_hint: "internships" }]), /2027 cycle/, "feed season validation");
  const feedMarkdown = `
| Company | Role | Location | Education | Application | Date Added |
|---|---|---|---|---|---|
| Example | FPGA Engineer Intern | Austin, TX | Undergrad | [Apply](https://jobs.example.com/careers/123456) | Jul 18 |
| ↳ | Quant Research Intern (PhD) | New York, NY | PhD | [Apply](https://jobs.example.com/careers/123457) | Jul 18 |
| Example | Software Intern | Toronto, ON | Undergrad | [Apply](https://jobs.example.com/careers/123458) | Jul 18 |
`;
  const feedSeeds = parseMarkdownFeed(feed, feedMarkdown);
  assertEqual(feedSeeds.length, 3, "markdown discovery rows");
  assertEqual(feedSeeds[0].company, "Example", "markdown company");
  assertEqual(feedSeeds[0].posted_at.endsWith("-07-18"), true, "markdown posting date");
  assertEqual(discoverySeedRejection(feedSeeds[0]), "", "undergraduate discovery role accepted");
  assertEqual(discoverySeedRejection(feedSeeds[1]), "graduate-degree-only role", "PhD discovery role rejected");
  assertEqual(
    applyUrlFromFeedRow('| Example | Role | <a href="https://i.imgur.com/apply.png"><img></a> [Apply](https://lifeattiktok.com/search/7654431844394322229) |'),
    "https://lifeattiktok.com/search/7654431844394322229",
    "custom official job URL selected over image",
  );
  assertEqual(isOfficialJobUrl("https://github.com/example/list"), false, "aggregator URL rejected");
  assertEqual(
    humanApplyUrl("https://api.smartrecruiters.com/v1/companies/Example/postings/744000123456789"),
    "https://jobs.smartrecruiters.com/Example/744000123456789",
    "SmartRecruiters API URL becomes a human application URL",
  );
  assertEqual(parseJsonFeed(feed, [{ company: "Example", role: "Software Engineer Intern", location: "Seattle, WA", education: "Undergrad", season: "Summer 2027", url: "https://example.com/jobs/987654", date_added: "2026-07-18" }]).length, 1, "JSON discovery rows");
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
