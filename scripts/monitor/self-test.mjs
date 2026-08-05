import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  canonicalApplyUrl,
  categorize,
  extractCompensation,
  hasVerifiedEntryLevelEvidence,
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
import {
  amazonJobToLead,
  amazonJobUrl,
  eightfoldInternshipCycleEvidence,
  eightfoldJobUrl,
  eightfoldSearchUrl,
  htmlJobFromDetail,
  htmlJobToLead,
  htmlJobUrl,
  isUnitedStatesTikTokJob,
  isUnitedStatesAmazonJob,
  oracleJobToHtmlShape,
  tiktokJobToLead,
  withScanDeadline,
} from "./adapters.mjs";
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
  isCareerLandingPageUrl,
  isOfficialJobUrl,
  parseJsonFeed,
  parseMarkdownFeed,
  providerDescriptorForSeed,
  validateDiscoveryFeeds,
  workdayRequisitionId,
} from "./feed_discovery.mjs";
import {
  officialPageRejection,
  titlesLikelySame,
} from "./official_page.mjs";

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

export async function assertRejects(callback, pattern, label) {
  try {
    await callback();
  } catch (error) {
    if (pattern.test(error.message)) return;
    throw new Error(`${label}: rejected with unexpected error ${JSON.stringify(error.message)}`);
  }
  throw new Error(`${label}: expected promise to reject`);
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
  assertEqual(normalizePostingDate("Jul 18, 2026"), "2026-07-18", "named calendar date is timezone invariant");
  assertEqual(normalizePostingDate("7/18/2026"), "2026-07-18", "numeric calendar date is timezone invariant");
  assertEqual(normalizePostingDate("2026-08-04T01:05:33"), "2026-08-04", "timezone-less ISO posting date keeps its calendar day");
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
    extractCompensation("Software Development Engineer I", "USA, CA, Cupertino - 127,100.00 - 185,000.00 USD annually"),
    "$127,100 - $185,000",
    "annual currency range without dollar signs",
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
    true,
    "Bachelor-eligible BS/MS graduate role accepted",
  );
  assertEqual(
    isEligibleRole("Quantitative Research Intern (PhD) - Summer 2027", ""),
    false,
    "PhD internship false positive",
  );
  assertEqual(
    isEligibleRole("Campus AI Research Engineer (Intern)", "2027 internship cycle\nUndergrad"),
    false,
    "synthetic discovery cycle does not make a generic internship eligible",
  );
  assertEqual(isEligibleRole("Software Engineer, Early Career", ""), true, "explicit early-career title accepted");
  assertEqual(isEligibleRole("Entry-Level Software Engineer", ""), true, "explicit entry-level title accepted");
  assertEqual(isEligibleRole("Software Engineer I", ""), false, "generic level-one role rejected");
  assertEqual(isRelevant("Software Development Engineer I"), true, "software development engineer title coverage");
  assertEqual(
    hasVerifiedEntryLevelEvidence(
      "Software Development Engineer I - AI/ML Network Infrastructure",
      "We're looking for a talented early-career engineer. Basic qualifications: Bachelor's degree in Computer Science.",
    ),
    true,
    "level-one role with official early-career and bachelor's evidence accepted",
  );
  assertEqual(
    isEligibleRole(
      "Software Engineer I",
      "Early career opportunity. Bachelor's degree required. Basic qualifications: 5+ years of non-internship professional software development experience.",
    ),
    false,
    "level-one role with senior experience requirement rejected",
  );
  assertEqual(
    isEligibleRole(
      "Software Engineer I",
      "Early career opportunity. Bachelor's degree required. Basic qualifications: 2+ years of professional experience.",
    ),
    true,
    "level-one role with at most two years of required experience accepted",
  );
  assertEqual(isRelevant("Campus Recruiter, Machine Learning and Quantitative Research"), false, "technical recruiter role rejected");
  assertEqual(isRelevant("2027 Infrastructure Private Equity Investment Associate"), false, "investment role rejected");
  assertEqual(isEligibleRole("Software Engineer, New Grad", ""), true, "explicit new-grad title accepted");
  assertEqual(isEligibleRole("Graduate Software Engineer", ""), true, "explicit graduate title accepted");
  assertEqual(isEligibleRole("Quantitative Trader - 2027", ""), true, "2027 title accepted");
  assertEqual(isEligibleRole("Software Engineer - 2027 Interns", ""), true, "plural interns are classified as an internship");
  assertEqual(isRelevant("FPGA Engineer Intern"), true, "hardware internship title coverage");
  assertEqual(isRelevant("Network Engineer Internship"), true, "network internship title coverage");
  assertEqual(isRelevant("Design Engineer Co-op"), true, "engineering co-op title coverage");
  assertEqual(isRelevant("Intern - UI/UX Researcher - Human Factor Engineer"), true, "human-factors engineering internship coverage");
  assertEqual(isRelevant("Co-Op, Software Product Management"), false, "product management role is outside tracked disciplines");
  assertEqual(isRelevant("AI Operations Intern"), false, "non-engineering operations role is outside tracked disciplines");
  assertEqual(
    isRelevant("Platform Campaign Intern (Operations Center) - 2027 Summer"),
    false,
    "nontechnical campaign internship is outside tracked disciplines",
  );
  assertEqual(
    categorize("Machine Learning Engineer Intern (Search-Basic Ranking) - 2027 Summer"),
    "Software / AI / ML",
    "ASIC token does not match the word Basic",
  );
  assertEqual(isRelevant("Technical Communications Intern - Summer 2027"), true, "technical communications coverage");
  assertEqual(isRelevant("Structural Engineer I - New Grad"), true, "structural engineering coverage");
  assertEqual(isRelevant("Flight Sciences Engineer - 2027"), true, "flight sciences coverage");
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
    isEligibleRole("Software Engineer, TensorRT - New College Grad 2025", ""),
    false,
    "pre-2027 new-grad title is rejected",
  );
  assertEqual(
    isEligibleRole("Software Engineer Intern", "Class of 2025 internship program"),
    false,
    "pre-2027 internship description is rejected",
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
    isFreshEnough({ company: "NVIDIA", title: "Software Engineer, New College Grad", location: "Santa Clara, CA", url: "https://example.com/jobs/new-college-grad-2025", grad_window: "Explicit new grad role" }),
    false,
    "pre-2027 recruiting year in official URL is rejected",
  );
  assertEqual(
    isFreshEnough({ company: "SpaceX", title: "New Graduate Engineer, Software (Starlink)", location: "Redmond, WA", url: "https://boards.greenhouse.io/spacex/jobs/8376990002", grad_window: "Explicit new grad role" }),
    false,
    "excluded requisition stays excluded after URL canonicalization",
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
  assertEqual(isAllowedLocation({ location: "Newmarket, Ontario, CA" }), false, "Canadian province excludes unfamiliar city");
  assertEqual(isAllowedLocation({ location: "Cork, CO, IE" }), false, "foreign ISO country code is not a US state");
  assertEqual(isDirectEmployerApplyUrl("https://app.ripplematch.com/v2/public/job/abc123"), false, "matching platform URL rejected");
  assertEqual(isDirectEmployerApplyUrl("https://jobs.ashbyhq.com/example/123456"), true, "official ATS URL accepted");
  assertEqual(normalizeCompanyName("Copart ✓"), "Copart", "source status marker removed from company name");
  assertEqual(normalizeCompanyName("IMC"), "IMC Trading", "company alias normalized");
  assertEqual(normalizeCompanyName("JPMorganChase"), "JPMorgan Chase", "JPMorgan alias normalized");
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
    canonicalApplyUrl("https://pod4.app.loxo.co/job/abc?t=1785793723"),
    "https://pod4.app.loxo.co/job/abc",
    "rotating Loxo timestamp canonicalization",
  );
  assertEqual(
    keyFor("Example", "Intern", "Austin, TX", "https://example.wd1.myworkdayjobs.com/jobs/job/Austin/Intern_R26-5631-2"),
    keyFor("Example", "Intern", "Austin, TX", "https://example.wd1.myworkdayjobs.com/jobs/job/Austin/Intern_R26-5631-1"),
    "Workday site suffixes share a requisition identity",
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
  assertEqual(toPublicRole({ ...preservedRole, verification_version: 4 }, "2026-07-13T12:00:00Z").verification_version, 4, "verification version is preserved");
  assertEqual(
    compareRoles(
      { role_type: "New Grad", discipline: "Software / AI / ML", company: "Older", title: "Engineer", location: "TX", posted_at: "2026-07-01", date_seen: "2026-07-10" },
      { role_type: "New Grad", discipline: "Software / AI / ML", company: "Newer", title: "Engineer", location: "TX", posted_at: "2026-07-12", date_seen: "2026-07-12" },
    ) > 0,
    true,
    "newest posting sorts first",
  );
  assertEqual(renderRoleDates({ posted_at: "2026-07-01", date_seen: "2026-07-05" }), "Posted Jul 1, 2026<br>First seen Jul 5, 2026", "posted and first-seen labels");
  assertTruthy(titlesLikelySame("Software Engineer, New Grad", "New Grad Software Engineer - Example Careers"), "job-title token matching");
  assertEqual(
    officialPageRejection(
      "https://careers.microsoft.com/us/en/job/200042229/Software-Engineer",
      "https://careers.microsoft.com/v2/global/en/errorPages/404.html",
      "<title>Microsoft Careers</title>",
      "Software Engineer",
    ),
    "redirected to an error page",
    "soft 404 redirect",
  );
  assertEqual(
    officialPageRejection(
      "https://job-boards.greenhouse.io/example/jobs/8049510",
      "https://job-boards.greenhouse.io/example?error=true",
      "<title>Example</title>",
      "Software Engineer I",
    ),
    "redirected to an error page",
    "Greenhouse error redirect",
  );
  assertEqual(
    officialPageRejection(
      "https://jobs.ashbyhq.com/example/31d09081-f5e7-45e4-b561-1c53d0ca9200",
      "https://jobs.ashbyhq.com/example/31d09081-f5e7-45e4-b561-1c53d0ca9200",
      "<title>Jobs</title>",
      "Software Engineer, New Grad",
    ),
    "official page shell does not expose the requisition",
    "unverified SPA shell is rejected",
  );
  assertEqual(
    officialPageRejection(
      "https://careers.example.com/jobs/8049510",
      "https://careers.example.com/jobs",
      '<title>Search jobs</title><a href="/jobs/8049510">Software Engineer, New Grad</a>',
      "Software Engineer, New Grad",
    ),
    "redirected away from the requisition",
    "search result containing the requisition ID is not a detail page",
  );
  assertEqual(
    providerDescriptorForSeed({ url: "https://jobs.ashbyhq.com/example/31d09081-f5e7-45e4-b561-1c53d0ca9200", company: "Example" }).adapter,
    "ashby",
    "Ashby provider descriptor",
  );
  assertEqual(
    providerDescriptorForSeed({ url: "https://www.amazon.jobs/en/jobs/10490741/software-development-engineer-i", company: "Amazon" }).id,
    "10490741",
    "Amazon provider descriptor",
  );
  assertEqual(
    providerDescriptorForSeed(
      { url: "https://apply.careers.microsoft.com/careers/job/1970393556922923", company: "Microsoft" },
      [{ company: "Microsoft", adapter: "eightfold", baseUrl: "https://apply.careers.microsoft.com", domain: "microsoft.com", targetYear: 2027 }],
    ).id,
    "1970393556922923",
    "Eightfold provider descriptor",
  );
  assertEqual(
    providerDescriptorForSeed({ url: "https://example.wd5.myworkdayjobs.com/en-US/External/job/Austin/Engineer_R123", company: "Example" }).site,
    "External",
    "Workday provider descriptor",
  );
  assertEqual(
    providerDescriptorForSeed({ url: "https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/job/210774111", company: "JPMorgan Chase" }).siteNumber,
    "CX_1001",
    "Oracle Recruiting provider descriptor",
  );
  assertEqual(
    providerDescriptorForSeed({ url: "https://job-boards.greenhouse.io/embed/job_app?for=towerresearchcapital&token=8024128", company: "Tower Research Capital" }).id,
    "8024128",
    "embedded Greenhouse application resolves to a requisition",
  );
  assertEqual(
    workdayRequisitionId("https://example.wd5.myworkdayjobs.com/External/job/Austin/Engineer_R123456-2/apply"),
    "r123456",
    "Workday duplicate-path suffix is excluded from requisition search",
  );
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
  const feedClosedLifecycle = await reconcileRoleLifecycle(
    [{ ...lifecycleRole, source_adapter: "discovery_feed" }],
    [],
    [],
    "2026-07-13T12:00:00Z",
    [lifecycleRole.url],
  );
  assertEqual(feedClosedLifecycle.roles.length, 0, "confirmed feed closure removes cached role");
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
  assertEqual(isCareerLandingPageUrl("https://careers.duolingo.com/"), true, "career root is a landing page");
  assertEqual(isOfficialJobUrl("https://careers.duolingo.com/"), false, "career root is not an application URL");
  assertEqual(isCareerLandingPageUrl("https://careers.duolingo.com/?gh_jid=1234567"), false, "embedded requisition query is not treated as a bare landing page");
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
  assertEqual(
    detectAtsSource(
      { company: "Example", career_url: "https://example.com/careers", priority: "P1" },
      ["https://example.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/job/123456"],
    ).adapter,
    "oracle",
    "Oracle Recruiting source fingerprint",
  );
  assertThrows(
    () => validateConfiguration(
      [{ company: "Example", career_url: "https://example.com/careers", priority: "P1" }],
      [{ company: "Example", adapter: "mystery" }],
    ),
    /unsupported/,
    "unknown adapter validation",
  );
  await assertRejects(
    () => withScanDeadline(new Promise(() => {}), 10, { company: "Example", adapter: "html_jobs" }),
    /scan timed out/,
    "source-level deadline",
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
              "addressCountry": { "@type": "Country", "name": "US" }
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

  const oracleSource = { company: "Example", baseUrl: "https://example.fa.oraclecloud.com", siteNumber: "CX_1", priority: "P0" };
  const oracleShape = oracleJobToHtmlShape(oracleSource, {
    Id: "123456",
    Title: "2027 Mechanical Engineering Development Program",
    PrimaryLocation: "Austin, TX, United States",
    ExternalDescriptionStr: "<p>Bachelor's students graduating in May 2027.</p>",
    ExternalPostedStartDate: "2026-08-01T04:00:00Z",
  });
  assertEqual(oracleShape.url, "https://example.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/job/123456", "Oracle direct job URL");
  assertTruthy(isEligibleRole(oracleShape.title, oracleShape.description), "Oracle description eligibility");

  const tiktokJob = {
    id: "7660000000000000000",
    title: "Mechanical Engineer Graduate - 2027 Start (BS/MS)",
    description: "Join our 2027 graduate class.",
    requirement: "Bachelor's or Master's degree.",
    city_info: {
      code: "CT_243",
      en_name: "Mountain View",
      parent: { code: "ST_31", en_name: "California", parent: { code: "CN_6", en_name: "United States of America", parent: null } },
    },
    job_post_info: { min_salary: 100000, max_salary: 130000, currency: "USD" },
  };
  assertTruthy(isUnitedStatesTikTokJob(tiktokJob), "TikTok US hierarchy detection");
  const tiktokLead = tiktokJobToLead({ company: "TikTok", priority: "P0" }, tiktokJob);
  assertEqual(tiktokLead.compensation, "$100,000 - $130,000", "TikTok structured salary");
  assertTruthy(isEligibleRole(tiktokLead.role_title, tiktokJob.description), "TikTok BS/MS graduate eligibility");

  const amazonSource = { company: "Amazon", baseUrl: "https://www.amazon.jobs", priority: "P0" };
  const amazonJob = {
    id_icims: "10490741",
    job_path: "/en/jobs/10490741/software-development-engineer-i-ai-ml-network-infrastructure-annapurna-labs",
    title: "Software Development Engineer I - AI/ML Network Infrastructure, Annapurna Labs",
    country_code: "USA",
    location: "US, CA, Cupertino",
    posted_date: "August 3, 2026",
    description: "We're looking for a talented early-career engineer.",
    basic_qualifications: "Bachelor's degree in Computer Science.",
    preferred_qualifications: "USA, CA, Cupertino - 127,100.00 - 185,000.00 USD annually",
  };
  assertTruthy(isUnitedStatesAmazonJob(amazonJob), "Amazon US job detection");
  assertEqual(
    amazonJobUrl(amazonSource, amazonJob),
    "https://www.amazon.jobs/en/jobs/10490741/software-development-engineer-i-ai-ml-network-infrastructure-annapurna-labs",
    "Amazon direct job URL",
  );
  const amazonLead = amazonJobToLead(amazonSource, amazonJob);
  assertEqual(amazonLead.compensation, "$127,100 - $185,000", "Amazon API salary extraction");
  assertEqual(amazonLead.graduation_match, "Verified early career (BS)", "Amazon evidence is retained for board filtering");
  assertTruthy(isFreshEnough(amazonLead), "Amazon early-career lead survives board freshness filtering");
  assertTruthy(
    isEligibleRole(amazonLead.role_title, `${amazonJob.description}\n${amazonJob.basic_qualifications}`),
    "Amazon early-career eligibility",
  );

  const eightfoldSource = {
    company: "Microsoft",
    baseUrl: "https://apply.careers.microsoft.com",
    domain: "microsoft.com",
    targetYear: 2027,
  };
  const eightfoldJob = {
    id: "1970393556922923",
    positionUrl: "/careers/job/1970393556922923",
    title: "Software Engineer: Cloud & Distributed Backend Intern Opportunities for University Students, Redmond",
    description: "Currently pursuing Bachelor's Degree in Computer Science with one term remaining after the internship.",
    datePosted: "2026-08-04T01:05:33",
    validThrough: "2027-01-31T01:05:33",
  };
  assertEqual(
    eightfoldSearchUrl(eightfoldSource, "intern", 10),
    "https://apply.careers.microsoft.com/api/pcsx/search?domain=microsoft.com&query=intern&location=United+States&start=10&sort_by=recent",
    "Eightfold search URL",
  );
  assertEqual(
    eightfoldJobUrl(eightfoldSource, eightfoldJob),
    "https://apply.careers.microsoft.com/careers/job/1970393556922923",
    "Eightfold direct job URL",
  );
  assertEqual(
    eightfoldInternshipCycleEvidence(eightfoldSource, eightfoldJob),
    "2027 internship eligible",
    "Microsoft university internship campaign evidence",
  );
  assertEqual(
    eightfoldInternshipCycleEvidence(eightfoldSource, { ...eightfoldJob, validThrough: "2026-12-01" }),
    "",
    "Eightfold internship without target-year campaign window is not inferred",
  );

  validateConfiguration(
    await readJson(targetPath, []),
    await readJson(sourcePath, []),
  );
}

await runSelfTests();
console.log("monitor self-test ok");
