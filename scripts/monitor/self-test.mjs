import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  canonicalApplyUrl,
  categorize,
  categorizeDisciplines,
  extractCompensation,
  hasVerifiedEntryLevelEvidence,
  isAllowedLocation,
  isEligibleRole,
  isDirectEmployerApplyUrl,
  isFreshEnough,
  isProbablySenior,
  isRelevant,
  keyFor,
  normalizePostingDate,
  normalizeCompanyName,
  normalizeDisplayText,
  normalizeRoleTitle,
  roleType,
  stableJobIdentity,
} from "./domain.mjs";
import {
  amazonJobToLead,
  amazonJobUrl,
  eightfoldInternshipCycleEvidence,
  eightfoldJobUrl,
  eightfoldSearchUrl,
  htmlJobFromDetail,
  htmlJobToLead,
  htmlMicrodataJobPosting,
  htmlJobUrl,
  isUnitedStatesTikTokJob,
  isUnitedStatesAmazonJob,
  oracleJobToHtmlShape,
  parseRssJobs,
  sitemapLocationFromJobUrl,
  tiktokJobToLead,
  titleFromJobUrl,
  withScanDeadline,
} from "./adapters.mjs";
import { readJson, validateConfiguration } from "./http.mjs";
import { configureCompanyMetadata, publicCompanyCatalog } from "./companies.mjs";
import {
  assertBoardIntegrity,
  compareRoles,
  csvEscape,
  normalizedErrorCategory,
  renderReadme,
  renderDisciplinePage,
  renderRoleDates,
  renderRolePage,
  toPublicRole,
} from "./output.mjs";
import { closedPageReason, reconcileRoleLifecycle } from "./lifecycle.mjs";
import { matchingJobPostingEvidence } from "./official_page.mjs";
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
const companyMetadataPath = path.join(dataDir, "company_metadata.json");
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
  assertEqual(normalizeDisplayText("Requires 2&#43; years and a Ph&#46;D&#46;"), "Requires 2+ years and a Ph.D.", "numeric HTML entities decode before eligibility checks");
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
    isEligibleRole("Software Engineer, New Grad", "Minimum Qualifications: Master's degree in Computer Science."),
    false,
    "graduate-degree-only minimum qualification rejected",
  );
  assertEqual(
    isEligibleRole(
      "Associate Staff Quantum Engineer",
      "Required Qualifications: Master's degree in Physics. Laboratory experience and communication skills. Preferred Qualifications: Optics experience. Education benefits are available to employees with a bachelor's degree.",
    ),
    false,
    "a later preferred heading does not turn a required master's degree into a preference",
  );
  assertEqual(
    isEligibleRole("Research Engineer, Early Career", "Required qualifications: An advanced degree in robotics or a related field."),
    false,
    "generic advanced-degree requirement rejected",
  );
  assertEqual(
    isEligibleRole("Research Engineer, Early Career", "Education: Doctorate in mechanical engineering required."),
    false,
    "doctorate-only requirement rejected",
  );
  assertEqual(
    isEligibleRole("Software Engineer, New Grad", "Requirements: M.S. in Computer Science, or B.S. with 3 years of experience."),
    false,
    "experienced bachelor's substitute is not a new-grad bachelor's path",
  );
  assertEqual(
    isEligibleRole("Communications Engineer-Associate Staff", "Minimum Qualifications: M.S. in Electrical Engineering. In lieu of an M.S., a B.S. with 2+ years of directly relevant experience is acceptable."),
    false,
    "punctuated bachelor's acronym with required experience is rejected",
  );
  assertEqual(
    isEligibleRole("Software Engineer, New Grad", "Requirements: M.S. in Computer Science, or B.S. in Computer Science."),
    true,
    "bachelor's-or-master's requirement without added experience accepted",
  );
  assertEqual(
    isEligibleRole("Software Engineer, New Grad", "Requirements: Bachelor's degree in Computer Science. Master's degree preferred."),
    true,
    "preferred master's degree does not override required bachelor's eligibility",
  );
  assertEqual(
    isEligibleRole("Associate Staff - Aerospace Engineer", "Requirements: M.S. in Aerospace Engineering. Candidates with a B.S. degree and three years' experience will also be considered. Recent Graduate Hiring Range: $100,000-$120,000."),
    false,
    "associate-staff role requiring a graduate degree or experienced bachelor's candidate rejected",
  );
  assertEqual(
    isEligibleRole("Data Analyst", "Requirements: Bachelor's degree in a technical field. Recent Graduate Hiring Range: $100,000-$120,000."),
    false,
    "recent-graduate salary band alone is not new-grad eligibility evidence",
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
  assertEqual(
    isEligibleRole(
      "Software Engineer (Associate, Experienced or Senior)",
      "Basic Qualifications (Required Skills/ Experience): Bachelor's degree. 2&#43; years of experience developing software.",
    ),
    false,
    "HTML-encoded required experience is rejected",
  );
  assertEqual(
    isEligibleRole(
      "Associate Mechanical Engineer",
      "what you'll bring: Bachelor's degree and at least one year of professional engineering experience.",
    ),
    false,
    "lowercase alternative qualification headings and one-year minimum are rejected",
  );
  assertEqual(
    isEligibleRole(
      "Associate Electrical Engineer",
      "Qualifications: Bachelor's degree. Preferred experience: two years of circuit design.",
    ),
    true,
    "experience stated only as preferred remains eligible",
  );
  assertEqual(
    isEligibleRole("Mechanical Design Engineer", "Full time\nEarly Career\nEngineering / Technology"),
    true,
    "structured early-career level from an official feed is accepted",
  );
  assertEqual(
    isEligibleRole("Mechanical Design Engineer", "Learn about our early career opportunities and benefits."),
    false,
    "generic early-career marketing copy is not treated as role-level evidence",
  );
  assertEqual(isEligibleRole("Entry-Level Software Engineer", ""), true, "explicit entry-level title accepted");
  assertEqual(
    isEligibleRole("Civil Engineering Analyst", "Kimley-Horn is looking for Engineering graduates to join our office in 2027. Qualifications: Bachelor's degree by Summer 2027."),
    true,
    "2027 civil engineering analyst role is in scope",
  );
  assertEqual(isEligibleRole("Junior Mechanical Engineer", ""), true, "junior physical-engineering title accepted");
  assertEqual(
    isEligibleRole(
      "Structural Analysis Engineer (Associate, Mid-level, or Senior)",
      "Bachelor's degree in engineering required. 2+ years of experience in structural analysis.",
    ),
    false,
    "associate-tier requisition requiring two years of experience is not a bachelor's new-grad role",
  );
  assertEqual(
    isProbablySenior("Structural Analysis Engineer (Associate, Mid-level, or Senior)"),
    false,
    "entry-inclusive multi-level title is not treated as senior-only",
  );
  assertEqual(isProbablySenior("Secure Systems Engineer (mid-career)"), true, "explicit mid-career title rejected");
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
    false,
    "level-one role requiring two years of professional experience rejected",
  );
  assertEqual(isRelevant("Campus Recruiter, Machine Learning and Quantitative Research"), false, "technical recruiter role rejected");
  assertEqual(isRelevant("2027 Infrastructure Private Equity Investment Associate"), false, "investment role rejected");
  assertEqual(isEligibleRole("Software Engineer, New Grad", ""), true, "explicit new-grad title accepted");
  assertEqual(isEligibleRole("Graduate Software Engineer", ""), true, "explicit graduate title accepted");
  assertEqual(isEligibleRole("Quantitative Trader - 2027", ""), true, "2027 title accepted");
  assertEqual(isEligibleRole("Software Engineer - 2027 Interns", ""), true, "plural interns are classified as an internship");
  assertEqual(
    roleType("New Grad Field Engineer I - Summer 2027 (For Current/Former HNTB Interns ONLY)", ""),
    "New Grad",
    "prior-intern eligibility note does not turn a new-grad job into an internship",
  );
  assertEqual(isEligibleRole("Flight Test Intern (Dec 2026-Feb 2027)", ""), true, "internships spanning into 2027 are retained");
  assertEqual(isEligibleRole("Assistant Mechanical Engineer", ""), true, "consulting assistant-engineer grade is treated as entry level");
  assertEqual(isRelevant("FPGA Engineer Intern"), true, "hardware internship title coverage");
  assertEqual(isRelevant("Network Engineer Internship"), true, "network internship title coverage");
  assertEqual(isRelevant("Design Engineer Co-op"), true, "engineering co-op title coverage");
  assertEqual(isRelevant("Intern - UI/UX Researcher - Human Factor Engineer"), true, "human-factors engineering internship coverage");
  assertEqual(isRelevant("Co-Op, Software Product Management"), true, "product management co-op coverage");
  assertEqual(categorize("Associate Product Manager, New Grad 2027"), "Product Management", "product manager category");
  assertEqual(isEligibleRole("Associate Product Manager, New Grad 2027", ""), true, "new-grad product manager remains eligible");
  assertEqual(isProbablySenior("Product Manager Intern - Summer 2027"), false, "product manager is not assumed to be a people manager");
  assertEqual(isProbablySenior("Senior Technical Product Manager"), true, "senior product manager is still excluded");
  assertEqual(isProbablySenior("Engineering Manager"), true, "engineering manager remains senior");
  assertEqual(categorize("Product Mgmt Intern - Summer 2027"), "Product Management", "abbreviated product management category");
  assertEqual(isRelevant("Technical Product Manager Intern - Summer 2027"), true, "technical product manager title coverage");
  assertEqual(categorizeDisciplines("Avionics Hardware Engineer, New Grad").join(","), "aerospace,hardware-electrical", "multi-discipline avionics classification");
  assertEqual(
    categorizeDisciplines("Electrical Hardware Engineer – HPC/AI Platform Engineering - Early Career").join(","),
    "hardware-electrical",
    "hardware product context does not create AI or software classifications",
  );
  assertEqual(
    isEligibleRole(
      "Electrical Hardware Engineer – HPC/AI Platform Engineering - Early Career",
      "Requirements: Hold a Bachelor's in Electrical Engineering or equivalent. Have 2-4 years of experience.",
    ),
    false,
    "two-to-four-year experience range is not bachelor new-grad eligible",
  );
  assertEqual(categorizeDisciplines("Manufacturing Engineer, New Grad").join(","), "manufacturing-industrial", "manufacturing has its own discipline");
  assertEqual(
    categorizeDisciplines("Structures Design Engineer, Entry Level", "", { companyDisciplines: ["aerospace", "mechanical"] }).join(","),
    "aerospace,mechanical",
    "structures design roles at aerospace employers receive aerospace and mechanical support",
  );
  assertEqual(
    categorizeDisciplines("Associate Transmission Line Structural Engineer").join(","),
    "other-engineering",
    "civil structural roles are not assumed to be aerospace or mechanical",
  );
  assertEqual(
    categorizeDisciplines("Assistant Structural Engineer Transmission Distribution", "", { companyDisciplines: ["aerospace", "mechanical"] }).join(","),
    "other-engineering",
    "civil infrastructure stays off aerospace and mechanical boards at diversified firms",
  );
  assertEqual(
    categorizeDisciplines("Water Distribution System Associate Hydraulic Engineer").join(","),
    "other-engineering",
    "civil water hydraulics are not assumed to be mechanical",
  );
  assertEqual(
    categorizeDisciplines("Co-op Engineer: Track Design/Rail - Fall/Winter 2026-2027", "Mechanical engineering majors may apply").join(","),
    "other-engineering",
    "rail-track civil roles do not inherit mechanical from degree text",
  );
  assertEqual(
    categorizeDisciplines("Assistant Structural Engineer Power", "", { companyDisciplines: ["aerospace", "mechanical"] }).join(","),
    "other-engineering",
    "power-sector structures do not inherit aerospace employer coverage",
  );
  assertEqual(
    categorizeDisciplines("Assistant Structural Engineer Aviation Federal", "", { companyDisciplines: ["aerospace", "mechanical"] }).join(","),
    "aerospace,mechanical",
    "explicit aviation structures retain aerospace and mechanical support",
  );
  assertEqual(
    categorizeDisciplines("Cybersecurity Test Engineer, Junior").join(","),
    "software",
    "software test roles are not assumed to be mechanical",
  );
  assertEqual(
    categorizeDisciplines("Power System Design Engineer - Entry Level", "", { companyDisciplines: ["aerospace", "mechanical"] }).join(","),
    "hardware-electrical",
    "power-system roles do not inherit aerospace or mechanical employer coverage",
  );
  assertEqual(
    categorizeDisciplines("Wide Bandgap Semiconductor Device and Process Integration Engineer", "", { companyDisciplines: ["aerospace"] }).join(","),
    "hardware-electrical",
    "semiconductor roles do not inherit aerospace employer coverage",
  );
  assertEqual(
    categorizeDisciplines("Photonics Test Engineer", "", { companyDisciplines: ["aerospace", "mechanical"] }).join(","),
    "hardware-electrical",
    "photonics test roles do not inherit physical employer coverage",
  );
  assertEqual(
    categorizeDisciplines("RF Systems Engineer Level 1", "", { companyDisciplines: ["aerospace"] }).join(","),
    "hardware-electrical",
    "RF systems roles are classified as hardware rather than generic aerospace",
  );
  assertEqual(
    categorizeDisciplines("Software QA Automation Engineer I").join(","),
    "software",
    "digital QA automation is not manufacturing engineering",
  );
  assertEqual(
    categorizeDisciplines("ML Validation Engineer - Early Career").join(","),
    "ai-ml",
    "ML validation roles are not assumed to be mechanical",
  );
  assertEqual(
    categorizeDisciplines("Junior Software Test Engineer (Flight Safety Systems)", "", { companyDisciplines: ["aerospace", "mechanical"] }).join(","),
    "aerospace,software",
    "flight-safety software is aerospace and software, not mechanical test",
  );
  assertEqual(
    categorizeDisciplines("Weld Engineer 1").join(","),
    "mechanical,manufacturing-industrial",
    "weld engineering is supported by mechanical and manufacturing boards",
  );
  assertEqual(
    categorizeDisciplines("2027 Engineering Corporate Internship Program Welding").join(","),
    "mechanical,manufacturing-industrial",
    "welding programs receive mechanical and manufacturing support",
  );
  assertTruthy(
    categorizeDisciplines("2027 Engineering Rotational Product Development Program").includes("mechanical"),
    "physical product-development programs receive mechanical support",
  );
  assertTruthy(categorizeDisciplines("Airborne Radar Systems Intern - Summer 2027").includes("aerospace"), "airborne radar receives aerospace support");
  assertEqual(categorize("Electrical Engineer Intern - Summer 2027"), "Hardware & Electrical Engineering", "electrical roles are not mechanical");
  assertEqual(
    categorizeDisciplines("Design Engineering Graduate (Design System & AI Workflow) - 2027 Start").includes("mechanical"),
    false,
    "digital design engineering is not treated as mechanical design engineering",
  );
  assertEqual(
    categorizeDisciplines("Forward Deployed Infrastructure Engineer, New Grad").some((discipline) => ["mechanical", "aerospace"].includes(discipline)),
    false,
    "infrastructure does not trigger the structures engineering vocabulary",
  );
  assertTruthy(categorizeDisciplines("Aerothermal Engineer, Entry Level").includes("aerospace"), "aerothermal aerospace classification");
  assertTruthy(categorizeDisciplines("Vehicle Dynamics Engineer I").includes("mechanical"), "vehicle dynamics mechanical classification");
  assertTruthy(categorizeDisciplines("CFD Engineer, Entry Level").includes("mechanical"), "CFD mechanical classification");
  assertEqual(
    titleFromJobUrl("https://www.lockheedmartinjobs.com/job/orlando/associate-mechanical-engineer/694/123456789"),
    "associate mechanical engineer",
    "sitemap ranking extracts the job title instead of the numeric requisition id",
  );
  assertEqual(
    titleFromJobUrl("https://sandia.jobs/albuquerque-nm/cleared-early-career-rd-mechanical-engineer/30EB9FE074C34C5B91D385CC16AAAA7B/job/"),
    "cleared early career rd mechanical engineer",
    "terminal job URL extracts the preceding title slug",
  );
  assertEqual(
    sitemapLocationFromJobUrl("https://sandia.jobs/albuquerque-nm/cleared-early-career-rd-mechanical-engineer/30EB9FE074C34C5B91D385CC16AAAA7B/job/"),
    "Albuquerque, NM",
    "terminal job URL extracts its location slug",
  );
  assertEqual(isRelevant("AI Operations Intern"), false, "non-engineering operations role is outside tracked disciplines");
  assertEqual(
    isRelevant("Platform Campaign Intern (Operations Center) - 2027 Summer"),
    false,
    "nontechnical campaign internship is outside tracked disciplines",
  );
  assertEqual(
    categorize("Machine Learning Engineer Intern (Search-Basic Ranking) - 2027 Summer"),
    "AI / Machine Learning",
    "ASIC token does not match the word Basic",
  );
  assertEqual(
    isEligibleRole("Applied Machine Learning Engineering Internships Winter 2027", "Explicit new grad role"),
    true,
    "plural internship title remains eligible",
  );
  assertEqual(
    toPublicRole({
      company: "Shopify",
      title: "Applied Machine Learning Engineering Internships Winter 2027",
      location: "New York, NY",
      grad_window: "Explicit new grad role",
      role_type: "New Grad",
      url: "https://example.com/jobs/shopify-internships",
    }, "2026-08-09T12:00:00Z").role_type,
    "Internship",
    "official plural internship title overrides stale new-grad classification",
  );
  assertEqual(
    toPublicRole({
      company: "GE Appliances",
      title: "Software Engineering Co-op_Summer 2027",
      location: "Louisville, KY",
      grad_window: "New grad or university grad",
      role_type: "New Grad",
      url: "https://example.com/jobs/ge-appliances-co-op",
    }, "2026-08-09T12:00:00Z").role_type,
    "Internship",
    "underscore-separated co-op title overrides stale new-grad classification",
  );
  assertThrows(
    () => assertBoardIntegrity([{
      company: "Shopify",
      title: "Applied Machine Learning Engineering Internships Winter 2027",
      role_type: "New Grad",
      disciplines: ["ai-ml"],
    }]),
    /Internship leaked into New Grad board/,
    "generation rejects internship-title leakage into the new-grad board",
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
    isEligibleRole(
      "Software Engineer I, Entry-Level (Graduation Date: Fall 2026-Summer 2027) - US",
      "A bachelor's or master's degree in Computer Science, graduating between Fall 2026 and Summer 2027. At least two previous software engineering internships or equivalent practical experience, with no more than two years of full-time professional experience.",
    ),
    true,
    "DoorDash 2027 entry-level SWE role remains eligible for bachelor's graduates",
  );
  assertEqual(
    isEligibleRole(
      "Software Engineer, New Grad 2027",
      "A bachelor's degree is required. At least two but no more than five years of professional experience is required.",
    ),
    false,
    "an experience ceiling does not hide a separate required minimum",
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
  assertEqual(isAllowedLocation({ location: "Pune, MH, IN" }), false, "Indian ISO country suffix is not Indiana");
  assertEqual(isAllowedLocation({ location: "Indianapolis, IN" }), true, "Indianapolis is not mistaken for India");
  assertEqual(isAllowedLocation({ location: "Haifa, Haifa District, IL" }), false, "Israeli IL country code is not Illinois");
  assertEqual(isDirectEmployerApplyUrl("https://app.ripplematch.com/v2/public/job/abc123"), false, "matching platform URL rejected");
  assertEqual(isDirectEmployerApplyUrl("https://jobs.ashbyhq.com/example/123456"), true, "official ATS URL accepted");
  assertEqual(normalizeCompanyName("Copart ✓"), "Copart", "source status marker removed from company name");
  assertEqual(normalizeCompanyName("IMC"), "IMC Trading", "company alias normalized");
  assertEqual(normalizeCompanyName("JPMorganChase"), "JPMorgan Chase", "JPMorgan alias normalized");
  assertEqual(normalizeCompanyName("Tower Research"), "Tower Research Capital", "company legal-name alias normalized");
  assertEqual(normalizeCompanyName("Susquehanna"), "Susquehanna International Group", "company short-name alias normalized");
  assertEqual(normalizeCompanyName("Pivotal Software"), "Pivotal", "Pivotal eVTOL feed label normalized");
  assertEqual(normalizeRoleTitle("Intern, Software Engineering 🆕"), "Intern, Software Engineering", "source marker removed from title");
  assertEqual(normalizeRoleTitle("Avionics Software Intern 🇺🇸"), "Avionics Software Intern", "country marker removed from title");
  assertEqual(
    stableJobIdentity("https://www.databricks.com/company/careers/product/product-management-intern-summer-2027-6883068002"),
    "6883068002",
    "employer career slugs expose their trailing requisition identity",
  );
  assertEqual(
    stableJobIdentity("https://sandia.jobs/albuquerque-nm/cleared-early-career-rd-mechanical-engineer/30EB9FE074C34C5B91D385CC16AAAA7B/job/"),
    "30eb9fe074c34c5b91d385cc16aaaa7b",
    "DirectEmployers requisition IDs are stable job identities",
  );
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
  const crossListedNewer = {
    company: "Newer Cross-Listed",
    title: "Hardware and Software Engineer",
    location: "TX",
    role_type: "New Grad",
    discipline: "Hardware & Electrical Engineering",
    disciplines: ["hardware-electrical", "software"],
    posted_at: "2026-07-13",
    date_seen: "2026-07-13",
    url: "https://example.com/jobs/cross-listed-newer",
  };
  const primarySoftwareOlder = {
    company: "Older Primary Software",
    title: "Software Engineer",
    location: "TX",
    role_type: "New Grad",
    discipline: "Software Engineering",
    disciplines: ["software"],
    posted_at: "2026-07-12",
    date_seen: "2026-07-12",
    url: "https://example.com/jobs/primary-software-older",
  };
  const crossDisciplineBoard = renderDisciplinePage(
    [primarySoftwareOlder, crossListedNewer],
    { scanned_at: "2026-07-13T12:00:00Z" },
    "New Grad",
    { slug: "software", name: "Software Engineering" },
  );
  assertEqual(
    crossDisciplineBoard.indexOf(crossListedNewer.company) < crossDisciplineBoard.indexOf(primarySoftwareOlder.company),
    true,
    "category page sorts by freshness before a role's primary discipline",
  );
  assertEqual(
    compareRoles(
      { role_type: "New Grad", discipline: "Software Engineering", company: "Old Discovery", title: "Engineer", location: "TX", posted_at: "", date_seen: "2026-07-13", updated_at: "Posted 30+ Days Ago" },
      { role_type: "New Grad", discipline: "Software Engineering", company: "Fresh Posting", title: "Engineer", location: "TX", posted_at: "2026-07-12", date_seen: "2026-07-12" },
    ) > 0,
    true,
    "old relative posting age does not sort as a newly discovered role",
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
      discipline: "Software Engineering",
      disciplines: ["software"],
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
      discipline: "Software Engineering",
      disciplines: ["software"],
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
  assertTruthy(newGradBoard.includes("new-grad/software.md"), "new-grad board links to software category");
  assertEqual(newGradBoard.includes("Software Engineer Intern"), false, "new-grad board excludes internship role");
  const internshipBoard = renderRolePage(boardRoles, boardCoverage, "Internship");
  assertTruthy(internshipBoard.includes("internships/software.md"), "internship board links to software category");
  assertEqual(internshipBoard.includes("Software Engineer, New Grad"), false, "internship board excludes new-grad role");
  const softwareNewGradBoard = renderDisciplinePage(
    boardRoles,
    boardCoverage,
    "New Grad",
    { slug: "software", name: "Software Engineering" },
  );
  assertTruthy(softwareNewGradBoard.includes("Software Engineer, New Grad"), "category board contains matching role");
  assertEqual(softwareNewGradBoard.includes("Software Engineer Intern"), false, "category board excludes other role type");
  assertEqual(closedPageReason(200, "This job is no longer available", "2026-07-13"), "explicit closed-page message", "closed page message");
  assertEqual(closedPageReason(200, '<script>{"validThrough":"2026-07-01"}</script>', "2026-07-13"), "expired on 2026-07-01", "expired structured posting");
  const policyEvidence = matchingJobPostingEvidence(
    '<script type="application/ld+json">{"@type":"JobPosting","title":"Software Engineer, New Grad","description":"Basic Qualifications: Bachelor&#39;s degree and 2&#43; years of experience."}</script>',
    "Software Engineer, New Grad",
  );
  assertTruthy(policyEvidence?.context.includes("2&#43; years"), "structured job requirements are available to lifecycle policy checks");
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
  const rssLifecycle = await reconcileRoleLifecycle(
    [{ ...lifecycleRole, source_adapter: "rss_jobs", source_id: "example|rss_jobs" }],
    [],
    [{ source: { company: "Example", adapter: "rss_jobs" }, leads: [], log: { status: "ok" } }],
    "2026-07-13T12:00:00Z",
  );
  assertEqual(rssLifecycle.roles.length, 0, "complete RSS source removes a cached role rejected by current policy");
  const feedClosedLifecycle = await reconcileRoleLifecycle(
    [{ ...lifecycleRole, source_adapter: "discovery_feed" }],
    [],
    [],
    "2026-07-13T12:00:00Z",
    [lifecycleRole.url],
  );
  assertEqual(feedClosedLifecycle.roles.length, 0, "confirmed feed closure removes cached role");
  const policyRejectedLifecycle = await reconcileRoleLifecycle(
    [lifecycleRole],
    [],
    [],
    "2026-07-13T12:00:00Z",
    [],
    [lifecycleRole.url],
  );
  assertEqual(policyRejectedLifecycle.roles.length, 0, "confirmed bachelor's-policy rejection removes cached role");
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

  const microdataFixture = `
    <div itemscope itemtype="http://schema.org/JobPosting">
      <meta itemprop="addressLocality" content="Decatur">
      <meta itemprop="addressRegion" content="AL">
      <meta itemprop="addressCountry" content="US">
      <meta itemprop="datePosted" content="Sat Aug 01 07:00:00 UTC 2026">
      <h1 itemprop="title">Weld Engineer 1</h1>
      <span itemprop="description"><p>Bachelor's degree required. No experience required.</p></span>
    </div>`;
  const microdata = htmlMicrodataJobPosting(microdataFixture);
  assertEqual(microdata.title, "Weld Engineer 1", "microdata job title");
  assertEqual(microdata.jobLocation, "Decatur, AL, US", "microdata job location");
  const microdataJob = htmlJobFromDetail({ company: "Example" }, "https://example.com/job/weld-engineer-1/123", microdataFixture);
  assertTruthy(isEligibleRole(microdataJob.title, microdataJob.description), "microdata experience evidence is preserved");

  const rssJobs = parseRssJobs(`
    <rss xmlns:g="http://base.google.com/ns/1.0"><channel><item>
      <title>Aerospace Engineer</title>
      <description><![CDATA[&lt;p&gt;Recent Graduate Hiring Range: $90,000 - $110,000.&lt;/p&gt;]]></description>
      <link>https://example.com/job/aerospace-engineer/123</link>
      <g:expiration_date>2026-09-30</g:expiration_date>
      <g:location>Lexington, MA, US</g:location>
    </item></channel></rss>`);
  assertEqual(rssJobs.length, 1, "RSS job parsed");
  assertEqual(rssJobs[0].location, "Lexington, MA, US", "RSS location parsed");
  assertEqual(
    isEligibleRole(rssJobs[0].title, rssJobs[0].description),
    false,
    "RSS recent-graduate salary band is not eligibility evidence",
  );

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

  const targets = await readJson(targetPath, []);
  validateConfiguration(targets, await readJson(sourcePath, []));
  const companyMetadata = await readJson(companyMetadataPath, {});
  configureCompanyMetadata(companyMetadata, targets);
  const companyCatalog = publicCompanyCatalog(targets);
  assertEqual(companyCatalog.companies.length, targets.length, "public company catalog covers every tracked company");
  assertTruthy(companyCatalog.recommendation_presets.every((preset) => preset.company_ids.length > 0), "every recommendation preset has companies");
  assertTruthy(companyCatalog.recommendation_presets.some((preset) => preset.discipline === "product-management"), "product management recommendation preset exists");
  assertTruthy(companyCatalog.recommendation_presets.some((preset) => preset.discipline === "mechanical"), "mechanical recommendation preset exists");
  assertTruthy(companyCatalog.recommendation_presets.some((preset) => preset.discipline === "aerospace"), "aerospace recommendation preset exists");
  const palantirSoftwareRole = toPublicRole({
    company: "Palantir",
    title: "Software Engineer, New Grad",
    location: "New York, NY",
    url: "https://www.palantir.com/careers/123",
  }, "2026-08-09T12:00:00Z");
  const northropSoftwareRole = toPublicRole({
    company: "Northrop Grumman",
    title: "Software Engineer, New Grad",
    location: "Falls Church, VA",
    url: "https://ngc.wd1.myworkdayjobs.com/job/123",
  }, "2026-08-09T12:00:00Z");
  const northropAerospaceRole = toPublicRole({
    company: "Northrop Grumman",
    title: "Aeronautical Engineer, New Grad",
    location: "Falls Church, VA",
    url: "https://ngc.wd1.myworkdayjobs.com/job/456",
  }, "2026-08-09T12:00:00Z");
  assertTruthy(
    renderDisciplinePage([palantirSoftwareRole], boardCoverage, "New Grad", { slug: "software", name: "Software Engineering" }).includes("🔥 Palantir"),
    "Palantir is featured on software boards",
  );
  assertEqual(
    renderDisciplinePage([northropSoftwareRole], boardCoverage, "New Grad", { slug: "software", name: "Software Engineering" }).includes("🔥 Northrop Grumman"),
    false,
    "Northrop is not globally featured on software boards",
  );
  assertTruthy(
    renderDisciplinePage([northropAerospaceRole], boardCoverage, "New Grad", { slug: "aerospace", name: "Aerospace Engineering" }).includes("🔥 Northrop Grumman"),
    "Northrop remains featured on aerospace boards",
  );
}

await runSelfTests();
console.log("monitor self-test ok");
