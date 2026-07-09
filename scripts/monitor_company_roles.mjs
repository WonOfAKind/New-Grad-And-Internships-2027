import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const dataDir = path.join(rootDir, "data");

const targetPath = path.join(dataDir, "company_sources.json");
const sourcePath = path.join(dataDir, "ats_sources.json");
const roleDataPath = path.join(dataDir, "roles.json");
const scanOutputPath = path.join(dataDir, "latest_scan.json");
const coverageOutputPath = path.join(dataDir, "coverage.json");
const csvOutputPath = path.join(dataDir, "roles.csv");
const readmePath = path.join(rootDir, "README.md");

function envInteger(name, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}; received ${JSON.stringify(raw)}`);
  }
  return value;
}

const recentDays = envInteger("RECENT_DAYS", 7, { min: 1, max: 365 });
const includeDirectPageLeads = process.env.INCLUDE_DIRECT_PAGE_LEADS === "1";
const maxNewPerCompany = envInteger("MAX_NEW_PER_COMPANY", 20, { min: 1, max: 500 });
const startedAt = Date.now();
const fetchTimeoutMs = envInteger("FETCH_TIMEOUT_MS", 7000, { min: 1000, max: 120000 });
const fetchRetries = envInteger("FETCH_RETRIES", 0, { min: 0, max: 5 });
const fetchRetryBaseMs = envInteger("FETCH_RETRY_BASE_MS", 350, { min: 0, max: 30000 });
const atsSourceConcurrency = envInteger("ATS_SOURCE_CONCURRENCY", 12, { min: 1, max: 64 });
const directPageConcurrency = envInteger("DIRECT_PAGE_CONCURRENCY", 48, { min: 1, max: 128 });
const htmlDetailConcurrency = envInteger("HTML_DETAIL_CONCURRENCY", 4, { min: 1, max: 16 });
const doubleCheckErrors = process.env.DOUBLE_CHECK_ERRORS !== "0";
const doubleCheckTimeoutMs = envInteger("DOUBLE_CHECK_TIMEOUT_MS", 15000, { min: 1000, max: 180000 });
const doubleCheckConcurrency = envInteger("DOUBLE_CHECK_CONCURRENCY", 16, { min: 1, max: 64 });
const staleAfterDays = envInteger("STALE_AFTER_DAYS", 21, { min: 1, max: 365 });
const minAtsSuccessPercent = envInteger("MIN_ATS_SUCCESS_PERCENT", 75, { min: 0, max: 100 });
const userAgent = "Mozilla/5.0 (compatible; Codex new-grad role monitor)";
const teslaStateUrl = "https://www.tesla.com/cua-api/apps/careers/state?site=US";
const supportedAdapters = new Set([
  "greenhouse",
  "lever",
  "ashby",
  "workday",
  "phenom",
  "avature",
  "tesla",
  "html_jobs",
  "google_careers",
]);
const defaultSearchTexts = [
  "software engineer",
  "new grad",
  "early career",
  "2027 intern",
  "data science",
  "technical writer",
  "mechanical engineer",
  "aerospace engineer",
  "hardware engineer",
  "quantitative",
];

const titleRolePatterns = [
  /(?:2027|summer\s+2027|spring\s+2027|fall\s+2027).*(?:software|developer|\bSWE\b|machine\s+learning|\bML\b|\bAI\b|data|platform|infrastructure|forward\s+deployed|quant|technical\s+writer|documentation|mechanical|aerospace|avionics|propulsion|manufacturing|systems)/i,
  /(?:software|developer|\bSWE\b|machine\s+learning|\bML\b|\bAI\b|data|platform|infrastructure|forward\s+deployed|quant|technical\s+writer|documentation|mechanical|aerospace|avionics|propulsion|manufacturing|systems).*(?:2027|summer\s+2027|spring\s+2027|fall\s+2027)/i,
  /new\s+grad(?:uate)?\s+engineer.*software/i,
  /graduate\s+(?:software|mechanical|aerospace|data|systems|manufacturing)\s+engineer/i,
  /software\s+(?:engineer|developer)/i,
  /(?:backend|frontend|full[-\s]?stack|application|factory|flight|security|embedded)\s+software/i,
  /\bSDE\b/i,
  /machine\s+learning\s+engineer/i,
  /\bML\s+engineer/i,
  /\bAI\s+(?:engineer|software engineer)/i,
  /data\s+(?:scientist|analyst|science|analytics)/i,
  /data\s+engineer/i,
  /applied\s+scientist/i,
  /technical\s+writer|documentation\s+(?:engineer|specialist|writer)|developer\s+documentation|api\s+writer/i,
  /mechanical\s+engineer|manufacturing\s+engineer|hardware\s+engineer|test\s+engineer|product\s+design\s+engineer/i,
  /aerospace\s+engineer|avionics|propulsion|guidance|navigation|controls|\bGNC\b|flight\s+systems|space\s+systems|mission\s+operations/i,
  /(?:software|platform|kubernetes|cloud)\s+infrastructure\s+engineer/i,
  /platform\s+(?:software\s+)?engineer/i,
  /site\s+reliability\s+engineer|\bSRE\b/i,
  /forward\s+deployed\s+(?:software\s+)?engineer/i,
  /quant(?:itative)?\s+(?:developer|engineer|researcher|trader|analyst)/i,
  /trading\s+(?:developer|engineer|systems?|platform)/i,
  /career\s+catalyst/i,
  /product\s+engineer/i,
  /(?:robotics|autonomy|simulation)\s+software\s+engineer/i,
];

const internshipPatterns = [
  /\bintern\b/i,
  /\binternship\b/i,
  /\bco[-\s]?op\b/i,
  /\bcoop\b/i,
  /\bapprentice(?:ship)?\b/i,
  /\bstudent\s+(?:intern|researcher)\b/i,
];

const earlyCareerPatterns = [
  /\bearly\s+careers?\b/i,
  /\bentry[-\s]?level\b/i,
  /\bcareer\s+catalyst\b/i,
  /\bnew\s+college\s+grad(?:uate)?\b/i,
  /\brecent\s+grad(?:uate)?\b/i,
];

const fullTimeNewGradPatterns = [
  /new\s+grad(?:uate)?/i,
  /university\s+grad(?:uate)?/i,
  /graduate\s+(?:software|mechanical|aerospace|data|systems|manufacturing)\s+engineer/i,
  /class\s+of\s+2027/i,
  /2027\s+grad(?:uate)?/i,
  /grad(?:uating|uation)?\s+(?:in\s+)?(?:spring|summer|fall|winter)?\s*2027/i,
  /(?:spring|summer|fall|winter)\s+2027\s+grad(?:uate)?/i,
  /(?:may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|dec(?:ember)?)\s+2027/i,
  /2027\s+(?:new\s+grad|university\s+grad|early\s+career)/i,
  ...earlyCareerPatterns,
];

const internshipEligiblePatterns = [
  /(?:summer|spring|fall|winter)\s+2027\s+(?:intern|internship|co[-\s]?op)/i,
  /(?:intern|internship|co[-\s]?op).*(?:summer|spring|fall|winter)\s+2027/i,
  /2027\s+(?:intern|internship|co[-\s]?op)/i,
  /class\s+of\s+2028/i,
  /grad(?:uating|uation)?\s+(?:in\s+)?(?:fall|winter)?\s*2027/i,
  /grad(?:uating|uation)?\s+(?:in\s+)?(?:spring|summer)?\s*2028/i,
];

const seniorPatterns = [
  /^senior\b/i,
  /\bsenior\b/i,
  /\bsr\.?\b/i,
  /\bstaff\b/i,
  /\bprincipal\b/i,
  /\blead\b/i,
  /\bmanager\b/i,
  /\bdirector\b/i,
  /\barchitect\b/i,
];

const excludedDegreeProgramPatterns = [
  /\bph\.?\s*d\.?\b/i,
  /\bdoctorate\b/i,
  /\bdoctoral\b/i,
  /\b(?:bs|b\.s\.)\s*\/\s*(?:ms|m\.s\.)\b/i,
  /\b(?:ms|m\.s\.)\s*\/\s*(?:ph\.?\s*d\.?|phd)\b/i,
  /\((?=[^)]*\b(?:ms|m\.s\.|master'?s)\b)[^)]*\)/i,
  /\bmaster'?s\b/i,
  /\bm\.?\s?s\.?\b/i,
];

const excludedLocationPatterns = [
  /canada|toronto|vancouver|montreal|ottawa/i,
  /mexico|brazil|argentina|chile|colombia/i,
  /india|bengaluru|bangalore/i,
  /singapore/i,
  /sydney|australia/i,
  /seoul|south korea/i,
  /london|dublin|ireland|united kingdom|uk\b/i,
  /germany|france|japan|poland|romania|netherlands|amsterdam/i,
];

const explicitUnitedStatesLocationPatterns = [
  /\b(?:United States(?: of America)?|US|USA|U\.S\.A\.?|U\.S\.)\b/i,
  /\b(?:Remote|Virtual|Hybrid)\s*[-,(]?\s*(?:US|USA|United States)\b/i,
  /\bWashington,?\s+D\.?C\.?\b/i,
  /(?:^|[,;/]\s*)(?:AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC)(?:\b|$)/,
];
const namedUnitedStatesStatePattern = /\b(?:Alabama|Alaska|Arizona|Arkansas|California|Colorado|Connecticut|Delaware|Florida|Georgia|Hawaii|Idaho|Illinois|Indiana|Iowa|Kansas|Kentucky|Louisiana|Maine|Maryland|Massachusetts|Michigan|Minnesota|Mississippi|Missouri|Montana|Nebraska|Nevada|New Hampshire|New Jersey|New Mexico|New York|North Carolina|North Dakota|Ohio|Oklahoma|Oregon|Pennsylvania|Rhode Island|South Carolina|South Dakota|Tennessee|Texas|Utah|Vermont|Virginia|Washington|West Virginia|Wisconsin|Wyoming)\b/i;

const aiPatterns = [/machine\s+learning/i, /\bAI\b/i, /\bML\b/i, /data/i, /model/i, /platform/i];
const targetGradPatterns = [
  /class\s+of\s+2027/i,
  /2027\s+grad(?:uate)?/i,
  /grad(?:uating|uation)?\s+(?:in\s+)?(?:spring|summer|fall|winter)?\s*2027/i,
  /(?:spring|summer|fall|winter)\s+2027\s+grad(?:uate)?/i,
  /(?:may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|dec(?:ember)?)\s+2027/i,
  /2027\s+(?:new\s+grad|university\s+grad|early\s+career)/i,
  /new\s+grad(?:uate)?.*2027/i,
];

const excludedGradWindowPatterns = [
  /class\s+of\s+2026/i,
  /2026\s+grad(?:uate)?/i,
  /grad(?:uating|uation)?\s+(?:in\s+)?(?:spring|summer|fall|winter)?\s*2026/i,
  /(?:spring|summer|fall|winter)\s+2026\s+grad(?:uate)?/i,
  /(?:may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|dec(?:ember)?)\s+2026/i,
  /2026\s+(?:new\s+grad|university\s+grad|early\s+career)/i,
  /(?:spring|summer|fall|winter)\s+2026/i,
  /2026\s+start/i,
  /start(?:ing)?\s+(?:in\s+)?(?:spring|summer|fall|winter)?\s*2026/i,
  /(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+2026\s+start/i,
];

const excludedDirectApplyUrls = new Set([
  "https://boards.greenhouse.io/spacex/jobs/8376990002?gh_jid=8376990002",
  "https://boards.greenhouse.io/spacex/jobs/8446263002?gh_jid=8446263002",
]);
const sourceByCompany = new Map();
const atsCompanyNames = new Set();

function normalize(value) {
  return String(value ?? "").trim();
}

function absoluteHttpUrl(baseUrl, value) {
  const candidate = normalize(value);
  if (!candidate) return "";
  try {
    const resolved = new URL(candidate, baseUrl);
    return ["http:", "https:"].includes(resolved.protocol) ? resolved.toString() : "";
  } catch {
    return "";
  }
}

function searchTextsFor(source) {
  const configured = Array.isArray(source.searchTexts) && source.searchTexts.length > 0
    ? source.searchTexts
    : [source.searchText, ...defaultSearchTexts];
  return [...new Set(configured.map(normalize).filter(Boolean))];
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function mapConcurrent(items, concurrency, mapper) {
  if (items.length === 0) return [];
  const results = new Array(items.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

function canonicalApplyUrl(url) {
  const value = normalize(url).replace(/&amp;/gi, "&");
  if (!value) return "";
  try {
    const parsed = new URL(value);
    parsed.hash = "";
    if (/\/jobs\/results\/\d+/i.test(parsed.pathname)) {
      parsed.search = "";
    } else {
      for (const key of [...parsed.searchParams.keys()]) {
        if (/^utm_/i.test(key) || /^(?:gh_src|lever-source|ref|referrer|source|sourceToken)$/i.test(key)) {
          parsed.searchParams.delete(key);
        }
      }
      parsed.searchParams.sort();
    }
    if (parsed.pathname !== "/") parsed.pathname = parsed.pathname.replace(/\/+$/, "");
    return parsed.toString();
  } catch {
    return value;
  }
}

function keyFor(company, title, location, url = "") {
  const normalizedUrl = canonicalApplyUrl(url).toLowerCase();
  if (normalizedUrl) return `url|${normalizedUrl}`;
  return `${normalize(company).toLowerCase()}|${normalize(title).replace(/\s+/g, " ").toLowerCase()}|${normalize(location).toLowerCase()}`;
}

function roleTitle(lead) {
  return lead.role_title ?? lead.title ?? "";
}

function applyUrl(lead) {
  return canonicalApplyUrl(lead.direct_apply_url ?? lead.url ?? "");
}

function isRelevant(title) {
  return titleRolePatterns.some((pattern) => pattern.test(title));
}

function isProbablySenior(title) {
  return seniorPatterns.some((pattern) => pattern.test(title));
}

function hasExcludedDegreeProgram(title) {
  return excludedDegreeProgramPatterns.some((pattern) => pattern.test(title));
}

function graduationMatch(title, text = "") {
  const haystack = `${title}\n${text}`;
  if (targetGradPatterns.some((pattern) => pattern.test(haystack))) return "2027 grad eligible";
  if (internshipPatterns.some((pattern) => pattern.test(title)) && internshipEligiblePatterns.some((pattern) => pattern.test(haystack))) return "2027 internship eligible";
  if (/new\s+grad|university\s+grad/i.test(haystack)) return "New grad or university grad";
  if (earlyCareerPatterns.some((pattern) => pattern.test(haystack))) return "Early career";
  if (internshipPatterns.some((pattern) => pattern.test(title))) return "Internship";
  return "";
}

function hasOnlyExcludedGraduationWindow(title, text = "") {
  const haystack = `${title}\n${text}`;
  const hasExcludedWindow = excludedGradWindowPatterns.some((pattern) => pattern.test(haystack));
  const hasTargetWindow = targetGradPatterns.some((pattern) => pattern.test(haystack));
  return hasExcludedWindow && !hasTargetWindow;
}

function roleType(title, text = "") {
  const haystack = `${title}\n${text}`;
  if (internshipPatterns.some((pattern) => pattern.test(title))) return "Internship";
  if (/\b(?:employment\s+type|job\s+type)\b.{0,60}\b(?:intern|internship|co[-\s]?op)\b/i.test(text)) return "Internship";
  if (fullTimeNewGradPatterns.some((pattern) => pattern.test(haystack))) return "New Grad";
  return "";
}

function isEligibleRole(title, text = "") {
  const haystack = `${title}\n${text}`;
  if (hasOnlyExcludedGraduationWindow(title, text)) return false;
  if (isProbablySenior(title)) return false;
  if (hasExcludedDegreeProgram(title)) return false;
  const type = roleType(title, text);
  if (type === "New Grad") return true;
  if (type === "Internship") return internshipEligiblePatterns.some((pattern) => pattern.test(haystack));
  return false;
}

function chooseResume(title, text = "", fallback = "General CS/SWE") {
  const haystack = `${title}\n${text}`;
  return aiPatterns.some((pattern) => pattern.test(haystack)) ? "AI/ML" : fallback;
}

function categorize(title, text = "") {
  const haystack = `${title}\n${text}`;
  if (/technical\s+writer|documentation|developer\s+docs|api\s+writer/i.test(haystack)) return "Technical Writing";
  if (/data\s+scientist|data\s+science|applied\s+scientist|analytics|data\s+analyst/i.test(haystack)) return "Data Science";
  if (/aerospace|avionics|propulsion|guidance|navigation|controls|\bGNC\b|flight\s+systems|space\s+systems|mission\s+operations/i.test(haystack)) return "Aerospace Engineering";
  if (/mechanical|manufacturing|hardware|product\s+design|test\s+engineer|robotics/i.test(haystack)) return "Mechanical Engineering";
  if (/machine\s+learning|\bAI\b|\bML\b|software|developer|\bSWE\b|infrastructure|platform|security|quant|trading|embedded|systems|data\s+engineer/i.test(haystack)) return "Software / AI / ML";
  return "Other";
}

function priorityFor(title, sourcePriority) {
  if (/top\s+secret|clearance/i.test(title)) return "P2";
  if (isProbablySenior(title)) return "P2";
  if (targetGradPatterns.some((pattern) => pattern.test(title))) return "P0";
  if (internshipEligiblePatterns.some((pattern) => pattern.test(title))) return "P0";
  if (earlyCareerPatterns.some((pattern) => pattern.test(title))) return "P0";
  if (/new\s+grad|university\s+grad|graduate\s+\w+\s+engineer/i.test(title)) return "P0";
  return sourcePriority ?? "P1";
}

function isFreshEnough(lead) {
  const title = roleTitle(lead);
  const context = `${lead.graduation_match ?? ""}\n${lead.grad_window ?? ""}\n${lead.category ?? ""}\n${lead.fit_notes ?? ""}\n${lead.role_type ?? ""}\n${lead.discipline ?? ""}`;
  if (excludedDirectApplyUrls.has(normalize(applyUrl(lead)))) return false;
  if (!isRelevant(title)) return false;
  if (!isEligibleRole(title, context)) return false;
  if (/2027/.test(`${lead.graduation_match ?? ""}\n${lead.grad_window ?? ""}`)) return true;
  if (/\b(?:new\s+grad(?:uate)?|university\s+grad(?:uate)?|graduate\s+\w+\s+engineer|early\s+careers?|entry[-\s]?level|career\s+catalyst|recent\s+grad(?:uate)?)\b/i.test(title)) return true;
  if (!lead.updated_at) return false;
  const updatedAt = Date.parse(lead.updated_at);
  if (Number.isNaN(updatedAt)) return false;
  const ageMs = Date.now() - updatedAt;
  return ageMs <= recentDays * 24 * 60 * 60 * 1000;
}

function isAllowedLocation(lead) {
  const location = normalize(lead.location);
  if (!location) return false;
  if (explicitUnitedStatesLocationPatterns.some((pattern) => pattern.test(location))) return true;
  if (excludedLocationPatterns.some((pattern) => pattern.test(location))) return false;
  return namedUnitedStatesStatePattern.test(location);
}

function fitNotes(title, category) {
  if (category === "Software / AI / ML") return "Software, AI/ML, infrastructure, systems, or quant-adjacent role.";
  if (category === "Data Science") return "Data science, analytics, applied science, or data engineering role.";
  if (category === "Technical Writing") return "Technical writing, API documentation, or developer docs role.";
  if (category === "Mechanical Engineering") return "Mechanical, hardware, manufacturing, robotics, or test engineering role.";
  if (category === "Aerospace Engineering") return "Aerospace, avionics, propulsion, flight systems, or space systems role.";
  return "Role matches one of the tracked early-career categories.";
}

function tailoringNotes(title, category, resumeChoice) {
  if (category === "2027 New Grad") {
    return "Emphasize expected 2027 graduation date, CS + Stats background, internships/projects, CS fundamentals, and truthful impact metrics.";
  }
  if (category === "New Grad SWE") {
    return "Emphasize CS fundamentals, projects, internships, testing, debugging, backend/systems work, and truthful impact metrics.";
  }
  if (category === "AI/ML Engineering" || resumeChoice === "AI/ML") {
    return "Emphasize Python, statistics, ML projects, data/model pipelines, evaluation, and software engineering quality.";
  }
  if (category === "SWE Infrastructure") {
    return "Emphasize backend services, infrastructure automation, distributed systems, reliability, cloud/container work, and observability.";
  }
  if (category === "Quant/Trading Engineering") {
    return "Emphasize algorithms, probability/statistics, performance, Python/C++, and rigorous project outcomes.";
  }
  return "Emphasize role-matching projects and skills without adding anything not already supported by the resume truth bank.";
}

function cleanCompensationText(value) {
  return normalize(value)
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&mdash;|&#8212;|&#x2014;/gi, " - ")
    .replace(/&ndash;|&#8211;|&#x2013;/gi, " - ")
    .replace(/&lt;\/?[a-z][\s\S]*?&gt;/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeCompensation(value) {
  return cleanCompensationText(value)
    .replace(/\s*[\u2013\u2014]\s*/g, " - ")
    .replace(/\s+\bto\b\s+/gi, " - ")
    .replace(/\s*\/\s*/g, "/")
    .replace(/\(\s*(USD|CAD|GBP|EUR)\s*\)/gi, "$1")
    .replace(/\$(\d{5,})(?=\D|$)/g, (_, digits) => `$${Number.parseInt(digits, 10).toLocaleString("en-US")}`)
    .replace(/\busd\b/gi, "USD")
    .trim();
}

function findCompensation(patterns, text, rejectHourly = false) {
  const haystack = cleanCompensationText(text);
  for (const pattern of patterns) {
    const match = haystack.match(pattern);
    if (!match) continue;
    const value = normalizeCompensation(match[1] ?? match[0]);
    if (rejectHourly && /\b(?:hourly|per hour|an hour|\/(?:hr|hour))\b/i.test(value)) continue;
    return value;
  }
  return "";
}

function compensationFromMoneyFallback(text, isInternship) {
  const haystack = cleanCompensationText(text);
  const markerIndex = haystack.search(/\b(?:salary\s+range|pay\s+range|pay\s+transparency|base\s+salary|compensation|hourly\s+range)\b/i);
  if (markerIndex < 0) return "";
  const window = haystack.slice(markerIndex, markerIndex + 900);
  if (isInternship) {
    const hourlyAmounts = [...window.matchAll(/\$\s?\d{1,3}(?:\.\d{1,2})?(?:\s*USD)?/gi)].map((match) => normalizeCompensation(match[0]));
    if (hourlyAmounts.length >= 2) return `${hourlyAmounts[0]} - ${hourlyAmounts[1]}`;
    if (hourlyAmounts.length === 1 && /\b(?:USD|hour|hourly|\/hr)\b/i.test(window)) return hourlyAmounts[0];
    return "";
  }
  const annualAmounts = [...window.matchAll(/\$\s?\d{2,3}(?:,\d{3})+(?:\.\d{1,2})?(?:\s*USD)?|\$\s?\d{5,6}(?:\.\d{1,2})?(?:\s*\(?\s*(?:USD|CAD|GBP|EUR)\s*\)?)?|\$\s?\d{2,3}\s?k\b(?:\s*USD)?/gi)]
    .map((match) => normalizeCompensation(match[0]));
  if (annualAmounts.length >= 2) return `${annualAmounts[0]} - ${annualAmounts[1]}`;
  if (annualAmounts.length === 1) return annualAmounts[0];
  return "";
}

function formatMoneyValue(value, currency = "USD") {
  const number = Number.parseFloat(String(value ?? "").replace(/,/g, ""));
  if (Number.isNaN(number)) return "";
  const rounded = Number.isInteger(number) ? number : Number(number.toFixed(2));
  const formatted = rounded.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return currency.toUpperCase() === "USD" ? `$${formatted}` : `${formatted} ${currency.toUpperCase()}`;
}

function compensationPeriodSuffix(value) {
  const unit = normalize(value).toUpperCase();
  if (/HOUR/.test(unit)) return "/hr";
  if (/DAY/.test(unit)) return "/day";
  if (/WEEK/.test(unit)) return "/week";
  if (/MONTH/.test(unit)) return "/month";
  return "";
}

function structuredCompensationFromValue(value, seen = new Set()) {
  if (!value || typeof value !== "object") return "";
  if (seen.has(value)) return "";
  seen.add(value);
  const candidate = value.baseSalary ?? value.estimatedSalary ?? (/\b(?:MonetaryAmount|MonetaryAmountDistribution)\b/i.test(normalize(value["@type"])) ? value : null);
  if (candidate && typeof candidate === "object") {
    const amount = candidate.value && typeof candidate.value === "object" ? candidate.value : candidate;
    const currency = normalize(candidate.currency ?? amount.currency) || "USD";
    const suffix = compensationPeriodSuffix(amount.unitText ?? candidate.unitText);
    const min = amount.minValue ?? amount.minvalue;
    const max = amount.maxValue ?? amount.maxvalue;
    const single = amount.value ?? amount.amount;
    if (min != null && max != null) {
      const minText = formatMoneyValue(min, currency);
      const maxText = formatMoneyValue(max, currency);
      if (minText && maxText) return `${minText} - ${maxText}${suffix}`;
    }
    const singleText = formatMoneyValue(single, currency);
    if (singleText) return `${singleText}${suffix}`;
  }
  for (const item of Object.values(value)) {
    if (!item || typeof item !== "object") continue;
    const nested = structuredCompensationFromValue(item, seen);
    if (nested) return nested;
  }
  return "";
}

function ensureHourlySuffix(value) {
  const normalized = normalizeCompensation(value);
  if (!normalized || /\b(?:hourly|per hour|an hour)\b|\/(?:hr|hour)\b/i.test(normalized)) return normalized;
  if (!/^\$\s?\d{1,3}(?:\.\d{1,2})?(?:\s*-\s*\$?\s?\d{1,3}(?:\.\d{1,2})?)?(?:\s+USD)?$/i.test(normalized)) return normalized;
  return /\s+USD$/i.test(normalized) ? normalized.replace(/\s+USD$/i, "/hr USD") : `${normalized}/hr`;
}

function textFromValue(value) {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map((item) => textFromValue(item)).join("\n");
  if (typeof value === "object") {
    return Object.entries(value)
      .map(([key, item]) => `${key}\n${textFromValue(item)}`)
      .join("\n");
  }
  return "";
}

function extractCompensation(title, ...texts) {
  const text = texts.map((value) => textFromValue(value)).join("\n");
  const haystack = cleanCompensationText(`${title}\n${text}`);
  const isInternship = roleType(title, text) === "Internship";
  const structuredCompensation = texts
    .map((value) => structuredCompensationFromValue(value))
    .find(Boolean) ?? "";
  const hourlyPatterns = [
    /\$\s?\d{1,3}(?:\.\d{1,2})?\s*(?:-|[\u2013\u2014]|to)\s*\$?\s?\d{1,3}(?:\.\d{1,2})?\s*(?:USD|\/\s?(?:hr|hour)|per\s+hour|an\s+hour|hourly)?\b/i,
    /\$\s?\d{1,3}(?:\.\d{1,2})?\s*(?:USD|\/\s?(?:hr|hour)|per\s+hour|an\s+hour|hourly)\b/i,
  ];
  const salaryPatterns = [
    /\$\s?\d{2,3}(?:,\d{3})+(?:\.\d{1,2})?\s*(?:-|[\u2013\u2014]|to)\s*\$?\s?\d{2,3}(?:,\d{3})+(?:\.\d{1,2})?(?:\s*(?:USD|per\s+year|annually|\/\s?(?:year|yr)|year|yr|base\s+salary))?/i,
    /\$\s?\d{5,6}(?:\.\d{1,2})?\s*(?:-|[\u2013\u2014]|to)\s*\$?\s?\d{5,6}(?:\.\d{1,2})?(?:\s*\(?\s*(?:USD|CAD|GBP|EUR)\s*\)?|\s*(?:per\s+year|annually|\/\s?(?:year|yr)|year|yr|base\s+salary))?/i,
    /\$\s?\d{2,3}\s?k\s*(?:-|[\u2013\u2014]|to)\s*\$?\s?\d{2,3}\s?k\b(?:\s*(?:USD|per\s+year|annually|\/\s?(?:year|yr)|year|yr|base\s+salary))?/i,
    /\b(?:salary|base\s+salary|compensation|pay\s+range|salary\s+range|base\s+pay)[^$]{0,180}(\$\s?\d{2,3}(?:,\d{3})+(?:\.\d{1,2})?(?:\s*(?:USD|per\s+year|annually|\/\s?(?:year|yr)|year|yr))?)/i,
    /\b(?:salary|base\s+salary|compensation|pay\s+range|salary\s+range|base\s+pay)[^$]{0,180}(\$\s?\d{5,6}(?:\.\d{1,2})?(?:\s*\(?\s*(?:USD|CAD|GBP|EUR)\s*\)?|\s*(?:per\s+year|annually|\/\s?(?:year|yr)|year|yr))?)/i,
    /\b(?:salary|base\s+salary|compensation|pay\s+range|salary\s+range|base\s+pay)[^$]{0,180}(\$\s?\d{2,3}\s?k\b(?:\s*(?:USD|per\s+year|annually|\/\s?(?:year|yr)|year|yr))?)/i,
    /\$\s?\d{2,3}(?:,\d{3})+(?:\.\d{1,2})?\s*(?:USD|per\s+year|annually|\/\s?(?:year|yr)|year|yr)\b/i,
    /\$\s?\d{5,6}(?:\.\d{1,2})?\s*(?:\(?\s*(?:USD|CAD|GBP|EUR)\s*\)?|per\s+year|annually|\/\s?(?:year|yr)|year|yr)\b/i,
    /\$\s?\d{2,3}\s?k\b\s*(?:USD|per\s+year|annually|\/\s?(?:year|yr)|year|yr)\b/i,
  ];
  if (isInternship) {
    return ensureHourlySuffix(findCompensation(hourlyPatterns, haystack) || structuredCompensation || compensationFromMoneyFallback(haystack, true));
  }
  return findCompensation(salaryPatterns, haystack, true) || structuredCompensation || compensationFromMoneyFallback(haystack, false);
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

function isHttpUrl(value) {
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

function validateConfiguration(targets, sources) {
  if (!Array.isArray(targets)) throw new Error("data/company_sources.json must contain a JSON array");
  if (!Array.isArray(sources)) throw new Error("data/ats_sources.json must contain a JSON array");
  if (targets.length === 0) throw new Error("data/company_sources.json must contain at least one company");
  if (sources.length === 0) throw new Error("data/ats_sources.json must contain at least one source");

  const targetCompanies = new Set();
  for (const [index, target] of targets.entries()) {
    const label = `company_sources.json[${index}]`;
    if (!normalize(target?.company)) throw new Error(`${label}.company is required`);
    const companyKey = normalize(target.company).toLowerCase();
    if (targetCompanies.has(companyKey)) throw new Error(`Duplicate company target: ${target.company}`);
    targetCompanies.add(companyKey);
    if (!isHttpUrl(target.career_url)) throw new Error(`${label}.career_url must be an HTTP(S) URL`);
    if (!/^P[0-2]$/.test(normalize(target.priority))) throw new Error(`${label}.priority must be P0, P1, or P2`);
  }

  const requiredByAdapter = {
    greenhouse: ["board"],
    lever: ["site"],
    ashby: ["board"],
    workday: ["tenant", "site"],
    phenom: ["baseUrl"],
    avature: ["baseUrl"],
    tesla: ["url"],
  };
  const sourceKeys = new Set();
  for (const [index, source] of sources.entries()) {
    const label = `ats_sources.json[${index}]`;
    if (!normalize(source?.company)) throw new Error(`${label}.company is required`);
    if (!supportedAdapters.has(source.adapter)) throw new Error(`${label}.adapter is unsupported: ${source.adapter}`);
    if (source.priority != null && !/^P[0-2]$/.test(normalize(source.priority))) {
      throw new Error(`${label}.priority must be P0, P1, or P2`);
    }
    if (!targetCompanies.has(normalize(source.company).toLowerCase())) {
      throw new Error(`${label}.company is missing from company_sources.json: ${source.company}`);
    }
    const sourceKey = `${normalize(source.company).toLowerCase()}|${source.adapter}`;
    if (sourceKeys.has(sourceKey)) throw new Error(`Duplicate ATS source: ${source.company} (${source.adapter})`);
    sourceKeys.add(sourceKey);
    for (const field of requiredByAdapter[source.adapter] ?? []) {
      if (!normalize(source[field])) throw new Error(`${label}.${field} is required for ${source.adapter}`);
    }
    if (["phenom", "avature"].includes(source.adapter) && !isHttpUrl(source.baseUrl)) {
      throw new Error(`${label}.baseUrl must be an HTTP(S) URL`);
    }
    if (source.adapter === "tesla" && !isHttpUrl(source.url)) {
      throw new Error(`${label}.url must be an HTTP(S) URL`);
    }
    if (["html_jobs", "google_careers"].includes(source.adapter)) {
      const urls = source.urls ?? (source.url ? [source.url] : []);
      if (!Array.isArray(urls) || urls.length === 0 || urls.some((url) => !isHttpUrl(url))) {
        throw new Error(`${label} must define at least one valid HTTP(S) url`);
      }
      for (const pattern of source.detailUrlPatterns ?? []) {
        try {
          new RegExp(pattern, "i");
        } catch (error) {
          throw new Error(`${label}.detailUrlPatterns contains an invalid regex: ${error.message}`);
        }
      }
    }
    if (source.searchTexts != null && (!Array.isArray(source.searchTexts) || source.searchTexts.length === 0 || source.searchTexts.some((value) => !normalize(value)))) {
      throw new Error(`${label}.searchTexts must be a non-empty array of strings`);
    }
    for (const field of ["timeoutMs", "doubleCheckTimeoutMs", "limit", "detailLimit", "maxPages"]) {
      if (source[field] != null && (!Number.isSafeInteger(source[field]) || source[field] <= 0)) {
        throw new Error(`${label}.${field} must be a positive integer`);
      }
    }
  }
}

function retryAfterMs(response) {
  const value = response.headers.get("retry-after");
  if (!value) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 120000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? 0 : Math.min(Math.max(date - Date.now(), 0), 120000);
}

async function fetchWithRetries(url, accept, readBody, timeoutMs = fetchTimeoutMs, init = {}) {
  let lastError;
  for (let attempt = 0; attempt <= fetchRetries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        ...init,
        signal: controller.signal,
        headers: {
          "User-Agent": userAgent,
          "Accept": accept,
          ...(init.headers ?? {}),
        },
      });
      if (!response.ok) {
        const error = new Error(`${response.status} ${response.statusText}`);
        error.retryable = response.status === 408 || response.status === 429 || response.status >= 500;
        error.retryAfterMs = retryAfterMs(response);
        throw error;
      }
      return await readBody(response);
    } catch (error) {
      lastError = error.name === "AbortError"
        ? Object.assign(new Error(`request timed out after ${timeoutMs}ms`), { retryable: true })
        : error;
      if (attempt >= fetchRetries || error.retryable === false) break;
      const jitter = fetchRetryBaseMs > 0 ? Math.floor(Math.random() * fetchRetryBaseMs) : 0;
      const retryDelayMs = Math.max(error.retryAfterMs ?? 0, fetchRetryBaseMs * (2 ** attempt) + jitter);
      await sleep(retryDelayMs);
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError;
}

async function fetchJson(url, timeoutMs = fetchTimeoutMs) {
  return fetchWithRetries(url, "application/json,text/plain,*/*", (response) => response.json(), timeoutMs);
}

async function fetchText(url, timeoutMs = fetchTimeoutMs, init = {}) {
  return fetchWithRetries(url, "text/html,text/plain,*/*", (response) => response.text(), timeoutMs, init);
}

function isRetryableScanError(errorMessage = "") {
  return /aborted|timeout|fetch failed|429|too many requests|econnreset|etimedout|socket/i.test(errorMessage);
}

function sourceErrorStatus(source, errorMessage = "") {
  if (source.adapter === "tesla" && /401|403|406|429|451|forbidden|access denied|akamai|permission/i.test(errorMessage)) {
    return "blocked";
  }
  return "error";
}

function sourceErrorLog(source, errorMessage, phase) {
  const status = sourceErrorStatus(source, errorMessage);
  const log = { company: source.company, adapter: source.adapter, status, error: errorMessage, phase };
  if (status === "blocked") {
    log.blocked_reason = "Tesla's official careers endpoint denied automated access from this runner; retry later or use the search-index/manual fallback.";
  }
  return log;
}

function directFetchInit(target) {
  if (target.fetch_mode !== "browser") return {};
  return {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36",
      "Accept": "text/html,application/json,*/*",
      "Accept-Language": "en-US,en;q=0.9",
      "Content-Type": "application/json",
    },
  };
}

function blockedDirectStatus(target, error) {
  if (!target.known_blocked) return null;
  if (!/403|forbidden|access denied|fetch failed|cloudflare|just a moment/i.test(error.message)) return null;
  return {
    company: target.company,
    status: "blocked",
    error: error.message,
    blocked_reason: target.blocked_reason ?? "Official career page blocks automated fetches; manual browser verification required.",
  };
}

function greenhouseJobToLead(source, job) {
  const title = normalize(job.title);
  const location = normalize(job.location?.name);
  const content = normalize(job.content);
  const category = categorize(title, content);
  const resumeChoice = chooseResume(title, content);
  const gradMatch = graduationMatch(title, content);
  return {
    detected_date: new Date().toISOString().slice(0, 10),
    company: source.company,
    role_title: title,
    location,
    resume_choice: resumeChoice,
    priority: priorityFor(title, source.priority),
    direct_apply_url: job.absolute_url,
    career_source_url: sourceByCompany.get(source.company)?.career_url ?? job.absolute_url,
    lead_status: "Tailor Resume",
    updated_at: job.updated_at ?? "",
    category,
    compensation: extractCompensation(title, content, job),
    graduation_match: gradMatch,
    jd_keywords: gradMatch === "2027 grad eligible" ? ["2027 graduation window"] : [],
    fit_notes: fitNotes(title, category),
    tailoring_notes: tailoringNotes(title, category, resumeChoice),
    apply_notes: "Review after resume upload; do not submit without user confirmation.",
  };
}

function leverJobToLead(source, job) {
  const title = normalize(job.text);
  const location = normalize(job.categories?.location);
  const listContent = (job.lists ?? [])
    .map((list) => `${list.text ?? ""}\n${list.content ?? ""}`)
    .join("\n");
  const content = normalize(`${job.descriptionPlain ?? ""}
${job.descriptionBodyPlain ?? ""}
${job.openingPlain ?? ""}
${job.additionalPlain ?? ""}
${job.additional ?? ""}
${listContent}`);
  const category = categorize(title, content);
  const resumeChoice = chooseResume(title, content);
  const gradMatch = graduationMatch(title, content);
  return {
    detected_date: new Date().toISOString().slice(0, 10),
    company: source.company,
    role_title: title,
    location,
    resume_choice: resumeChoice,
    priority: priorityFor(title, source.priority),
    direct_apply_url: job.hostedUrl ?? job.applyUrl,
    career_source_url: sourceByCompany.get(source.company)?.career_url ?? job.hostedUrl ?? job.applyUrl,
    lead_status: "Tailor Resume",
    updated_at: job.createdAt ? new Date(job.createdAt).toISOString() : "",
    category,
    compensation: extractCompensation(title, content, job),
    graduation_match: gradMatch,
    jd_keywords: gradMatch === "2027 grad eligible" ? ["2027 graduation window"] : [],
    fit_notes: fitNotes(title, category),
    tailoring_notes: tailoringNotes(title, category, resumeChoice),
    apply_notes: "Review after resume upload; do not submit without user confirmation.",
  };
}

function stripHtml(html = "") {
  return normalize(html.replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " "));
}

function ashbyJobToLead(source, job) {
  const title = normalize(job.title);
  const secondaryLocations = (job.secondaryLocations ?? [])
    .map((item) => normalize(item.location))
    .filter(Boolean);
  const location = [normalize(job.location), ...secondaryLocations].filter(Boolean).join("; ");
  const content = stripHtml(job.descriptionHtml);
  const category = categorize(title, content);
  const resumeChoice = chooseResume(title, content);
  const gradMatch = graduationMatch(title, content);
  return {
    detected_date: new Date().toISOString().slice(0, 10),
    company: source.company,
    role_title: title,
    location,
    resume_choice: resumeChoice,
    priority: priorityFor(title, source.priority),
    direct_apply_url: job.jobUrl ?? job.applyUrl,
    career_source_url: sourceByCompany.get(source.company)?.career_url ?? job.jobUrl ?? job.applyUrl,
    lead_status: "Tailor Resume",
    updated_at: job.publishedAt ?? "",
    category,
    compensation: extractCompensation(title, content, job),
    graduation_match: gradMatch,
    jd_keywords: gradMatch === "2027 grad eligible" ? ["2027 graduation window"] : [],
    fit_notes: fitNotes(title, category),
    tailoring_notes: tailoringNotes(title, category, resumeChoice),
    apply_notes: "Review after resume upload; do not submit without user confirmation.",
  };
}

function workdayJobToLead(source, job) {
  const info = job.jobPostingInfo && typeof job.jobPostingInfo === "object" ? job.jobPostingInfo : {};
  const title = normalize(info.title ?? job.title);
  const additionalLocations = Array.isArray(info.additionalLocations)
    ? info.additionalLocations.map((item) => normalize(item?.location ?? item)).filter(Boolean)
    : [];
  const location = [normalize(info.location ?? job.locationsText), ...additionalLocations].filter(Boolean).join("; ");
  const description = stripHtml(info.jobDescription ?? job.jobDescription ?? "");
  const content = normalize(`${title}\n${info.timeType ?? job.timeType ?? ""}\n${location}\n${description}\n${(job.bulletFields ?? []).join("\n")}`);
  const category = categorize(title, content);
  const resumeChoice = chooseResume(title, content);
  const gradMatch = graduationMatch(title, content);
  const host = source.host ?? `${source.tenant}.wd1.myworkdayjobs.com`;
  const url = `https://${host}/${source.site}${job.externalPath}`;
  return {
    detected_date: new Date().toISOString().slice(0, 10),
    company: source.company,
    role_title: title,
    location,
    resume_choice: resumeChoice,
    priority: priorityFor(title, source.priority),
    direct_apply_url: url,
    career_source_url: sourceByCompany.get(source.company)?.career_url ?? url,
    lead_status: "Tailor Resume",
    updated_at: info.postedOn ?? info.startDate ?? job.postedOn ?? "",
    category,
    compensation: extractCompensation(title, content, job),
    graduation_match: gradMatch,
    jd_keywords: gradMatch === "2027 grad eligible" ? ["2027 graduation window"] : [],
    fit_notes: fitNotes(title, category),
    tailoring_notes: tailoringNotes(title, category, resumeChoice),
    apply_notes: "Review after resume upload; do not submit without user confirmation.",
  };
}

function phenomJobToLead(source, job) {
  const title = normalize(job.title);
  const location = normalize(job.location ?? job.cityStateCountry ?? job.cityState);
  const content = normalize(`${job.descriptionTeaser ?? ""}\n${job.type ?? ""}\n${job.experienceLevel ?? ""}\n${job.category ?? ""}`);
  const category = categorize(title, content);
  const resumeChoice = chooseResume(title, content);
  const gradMatch = graduationMatch(title, content);
  return {
    detected_date: new Date().toISOString().slice(0, 10),
    company: source.company,
    role_title: title,
    location,
    resume_choice: resumeChoice,
    priority: priorityFor(title, source.priority),
    direct_apply_url: absoluteHttpUrl(source.baseUrl, job.applyUrl ?? job.url) || sourceByCompany.get(source.company)?.career_url,
    career_source_url: sourceByCompany.get(source.company)?.career_url ?? absoluteHttpUrl(source.baseUrl, job.applyUrl ?? job.url),
    lead_status: "Tailor Resume",
    updated_at: job.postedDate ?? job.dateCreated ?? "",
    category,
    compensation: extractCompensation(title, content, job),
    graduation_match: gradMatch,
    jd_keywords: gradMatch === "2027 grad eligible" ? ["2027 graduation window"] : [],
    fit_notes: fitNotes(title, category),
    tailoring_notes: tailoringNotes(title, category, resumeChoice),
    apply_notes: "Review after resume upload; do not submit without user confirmation.",
  };
}

function avatureJobToLead(source, job) {
  const title = normalize(job.title);
  const location = normalize(job.location);
  const content = normalize(`${job.title ?? ""}\n${job.location ?? ""}\n${job.description ?? ""}`);
  const category = categorize(title, content);
  const resumeChoice = chooseResume(title, content);
  const gradMatch = graduationMatch(title, content);
  return {
    detected_date: new Date().toISOString().slice(0, 10),
    company: source.company,
    role_title: title,
    location,
    resume_choice: resumeChoice,
    priority: priorityFor(title, source.priority),
    direct_apply_url: absoluteHttpUrl(source.baseUrl, job.url),
    career_source_url: sourceByCompany.get(source.company)?.career_url ?? absoluteHttpUrl(source.baseUrl, job.url),
    lead_status: "Tailor Resume",
    updated_at: "",
    category,
    compensation: extractCompensation(title, content, job),
    graduation_match: gradMatch,
    jd_keywords: gradMatch === "2027 grad eligible" ? ["2027 graduation window"] : [],
    fit_notes: fitNotes(title, category),
    tailoring_notes: tailoringNotes(title, category, resumeChoice),
    apply_notes: "Review after resume upload; do not submit without user confirmation.",
  };
}

function htmlAttributeContent(html, attributeName) {
  const escapedName = attributeName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const afterName = new RegExp(`<meta\\s+[^>]*(?:name|property)=["']${escapedName}["'][^>]*content=["']([^"']*)["'][^>]*>`, "i");
  const beforeName = new RegExp(`<meta\\s+[^>]*content=["']([^"']*)["'][^>]*(?:name|property)=["']${escapedName}["'][^>]*>`, "i");
  return cleanCompensationText(afterName.exec(html)?.[1] ?? beforeName.exec(html)?.[1] ?? "");
}

function htmlLinkHref(html, relName) {
  const escapedName = relName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const afterRel = new RegExp(`<link\\s+[^>]*rel=["'][^"']*${escapedName}[^"']*["'][^>]*href=["']([^"']*)["'][^>]*>`, "i");
  const beforeRel = new RegExp(`<link\\s+[^>]*href=["']([^"']*)["'][^>]*rel=["'][^"']*${escapedName}[^"']*["'][^>]*>`, "i");
  return cleanCompensationText(afterRel.exec(html)?.[1] ?? beforeRel.exec(html)?.[1] ?? "");
}

function googleCareersUrl(baseUrl, href) {
  const value = normalize(href);
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith("/about/careers/")) return `https://www.google.com${value}`;
  if (value.startsWith("jobs/results/")) return `https://www.google.com/about/careers/applications/${value}`;
  return new URL(value, baseUrl).toString();
}

function googleTitleFromHtml(html) {
  const metaTitle = htmlAttributeContent(html, "og:title") || htmlAttributeContent(html, "twitter:title");
  const title = metaTitle || cleanCompensationText(/<title>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "");
  return title.replace(/\s+(?:-|—)\s+Google Careers$/i, "").trim();
}

function googleDetailContent(html) {
  const description = htmlAttributeContent(html, "description");
  const start = html.search(/<h3>\s*Minimum qualifications/i);
  const body = start >= 0
    ? html.slice(start, Math.min(html.length, start + 35000))
    : "";
  return cleanCompensationText(`${description}\n${stripHtml(body)}`);
}

function googleCardSummaries(baseUrl, html) {
  return [...html.matchAll(/<a\s+class=["'][^"']*\bSi6A0c\b[^"']*["']\s+href=["']([^"']+)["']>([\s\S]*?)<\/a>/gi)]
    .map((match) => {
      const card = match[2] ?? "";
      const title = cleanCompensationText(/<h3[^>]*>([\s\S]*?)<\/h3>/i.exec(card)?.[1] ?? "");
      const location = cleanCompensationText(stripHtml(/<p[^>]*>([\s\S]*?)<\/p>/i.exec(card)?.[1] ?? ""));
      return { title, location, url: googleCareersUrl(baseUrl, match[1]) };
    })
    .filter((job) => job.title && job.url);
}

function googleJobToLead(source, job) {
  const title = normalize(job.title);
  const location = normalize(job.location);
  const content = normalize(`${job.title ?? ""}\n${job.location ?? ""}\n${job.description ?? ""}`);
  const category = categorize(title, content);
  const resumeChoice = chooseResume(title, content);
  const gradMatch = graduationMatch(title, content);
  return {
    detected_date: new Date().toISOString().slice(0, 10),
    company: source.company,
    role_title: title,
    location,
    resume_choice: resumeChoice,
    priority: priorityFor(title, source.priority),
    direct_apply_url: job.url,
    career_source_url: sourceByCompany.get(source.company)?.career_url ?? job.url,
    lead_status: "Tailor Resume",
    updated_at: "",
    category,
    compensation: extractCompensation(title, content, job),
    graduation_match: gradMatch,
    jd_keywords: gradMatch === "2027 grad eligible" ? ["2027 graduation window"] : [],
    fit_notes: fitNotes(title, category),
    tailoring_notes: tailoringNotes(title, category, resumeChoice),
    apply_notes: "Review after resume upload; do not submit without user confirmation.",
  };
}

function htmlJobUrl(source, baseUrl, href) {
  const value = normalize(href).replace(/&amp;/gi, "&");
  if (!value) return "";
  const resolved = /^https?:\/\//i.test(value) ? value : new URL(value, source.relativeJobBase ?? baseUrl).toString();
  if (source.keepDetailQuery === true) return resolved;
  const parsed = new URL(resolved);
  const withoutQuery = `${parsed.origin}${parsed.pathname}`;
  if (htmlDetailPatterns(source).some((pattern) => pattern.test(withoutQuery) || pattern.test(resolved))) {
    return withoutQuery;
  }
  return resolved;
}

function htmlDetailPatterns(source) {
  const patterns = source.detailUrlPatterns ?? [
    "/jobs/results/\\d+",
    "/careers/(?:job|jobs|positions?)/",
    "/jobs/[^/?#]+",
  ];
  return patterns.map((pattern) => new RegExp(pattern, "i"));
}

function isHtmlDetailUrl(source, url) {
  return htmlDetailPatterns(source).some((pattern) => pattern.test(url));
}

function htmlCanonicalJobUrl(source, baseUrl, html, fallbackUrl) {
  const canonical = htmlLinkHref(html, "canonical")
    || htmlAttributeContent(html, "og:url")
    || htmlAttributeContent(html, "twitter:url")
    || fallbackUrl;
  return htmlJobUrl(source, baseUrl, canonical);
}

function htmlTitleFromHtml(html, source = {}) {
  const metaTitle = htmlAttributeContent(html, "og:title") || htmlAttributeContent(html, "twitter:title");
  const h1Title = cleanCompensationText(/<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1] ?? "");
  const title = metaTitle || h1Title || cleanCompensationText(/<title>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "");
  const suffixPattern = source.titleSuffixPattern
    ? new RegExp(source.titleSuffixPattern, "i")
    : /\s+(?:-|[\u2013\u2014])\s+[^|]+(?:careers|jobs)$/i;
  return title.replace(suffixPattern, "").trim();
}

function jsonLdObjects(html) {
  const objects = [];
  for (const match of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      objects.push(JSON.parse(match[1].trim()));
    } catch {
      // Many pages include unrelated or malformed schema snippets; skip those safely.
    }
  }
  return objects;
}

function collectJobPostingNodes(value, nodes = []) {
  if (!value || typeof value !== "object") return nodes;
  const type = Array.isArray(value["@type"]) ? value["@type"].join(" ") : normalize(value["@type"]);
  if (/\bJobPosting\b/i.test(type)) nodes.push(value);
  if (Array.isArray(value)) {
    for (const item of value) collectJobPostingNodes(item, nodes);
  } else {
    for (const item of Object.values(value)) collectJobPostingNodes(item, nodes);
  }
  return nodes;
}

function htmlStructuredJobPostings(html) {
  return jsonLdObjects(html).flatMap((object) => collectJobPostingNodes(object));
}

function structuredLocationText(location) {
  const locations = Array.isArray(location) ? location : [location];
  return locations
    .map((item) => {
      if (!item || typeof item !== "object") return normalize(item);
      const address = item.address && typeof item.address === "object" ? item.address : {};
      return normalize([
        item.name,
        address.addressLocality,
        address.addressRegion,
        address.addressCountry,
      ].filter(Boolean).join(", "));
    })
    .filter(Boolean)
    .join("; ");
}

function htmlDetailContent(html, source = {}, structuredJob = null) {
  const description = htmlAttributeContent(html, "description") || stripHtml(structuredJob?.description ?? "");
  const startPattern = source.contentStartPattern
    ? new RegExp(source.contentStartPattern, "i")
    : /<h[1-4][^>]*>\s*(?:Minimum qualifications|Required qualifications|Requirements|Responsibilities|About the job|About this role|Job description|What you'll do)/i;
  const start = html.search(startPattern);
  const mainMatch = /<main[\s\S]*?<\/main>/i.exec(html);
  const bodyMatch = /<body[\s\S]*?<\/body>/i.exec(html);
  const body = start >= 0
    ? html.slice(start, Math.min(html.length, start + 35000))
    : (mainMatch?.[0] ?? bodyMatch?.[0] ?? html.slice(0, 50000));
  return cleanCompensationText(`${description}\n${stripHtml(body)}`);
}

function htmlCardSummaries(source, baseUrl, html) {
  return [...html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
    .map((match) => {
      const url = htmlJobUrl(source, baseUrl, match[1]);
      if (!isHtmlDetailUrl(source, url)) return null;
      const card = match[2] ?? "";
      const title = cleanCompensationText(
        /<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/i.exec(card)?.[1]
        ?? /aria-label=["']([^"']+)["']/i.exec(match[0])?.[1]
        ?? stripHtml(card),
      );
      const location = cleanCompensationText(stripHtml(/<p[^>]*>([\s\S]*?)<\/p>/i.exec(card)?.[1] ?? ""));
      return { title, location, url };
    })
    .filter(Boolean)
    .filter((job) => job.title && job.url);
}

function htmlJobFromDetail(source, url, html, seed = {}) {
  const structuredJob = htmlStructuredJobPostings(html)[0] ?? null;
  const title = normalize(structuredJob?.title) || htmlTitleFromHtml(html, source) || normalize(seed.title);
  const location = structuredLocationText(structuredJob?.jobLocation) || normalize(seed.location) || normalize(source.location);
  const description = htmlDetailContent(html, source, structuredJob);
  const canonicalUrl = htmlCanonicalJobUrl(source, url, html, url);
  return {
    ...structuredJob,
    ...seed,
    title,
    location,
    description,
    url: canonicalUrl,
  };
}

function htmlJobToLead(source, job) {
  return googleJobToLead(source, job);
}

function teslaTypeLabel(value) {
  const labels = {
    fulltime: "Full-Time",
    parttime: "Part-Time",
    intern: "Intern/Apprentice",
    seasonal: "Seasonal",
  };
  const key = normalize(value).toLowerCase();
  return labels[key] ?? normalize(value).replace(/[_-]+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function teslaSlug(title, jobId) {
  const slug = normalize(title).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "job";
  return `https://www.tesla.com/careers/search/job/${slug}-${jobId}`;
}

function teslaStringLookup(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [String(key), normalize(item)]));
}

function teslaIdSet(value) {
  if (value == null) return new Set();
  if (Array.isArray(value)) return new Set(value.map((item) => normalize(item)).filter(Boolean));
  const id = normalize(value);
  return id ? new Set([id]) : new Set();
}

function collectTeslaLocationIds(node, ids) {
  const cities = node?.cities;
  if (cities && typeof cities === "object") {
    for (const values of Object.values(cities)) {
      for (const id of teslaIdSet(values)) ids.add(id);
    }
  }
  for (const state of node?.states ?? []) {
    if (state && typeof state === "object") collectTeslaLocationIds(state, ids);
  }
}

function teslaLocationIdsForSite(payload, site = "US") {
  const ids = new Set();
  const wanted = site.toLowerCase();
  for (const region of payload.geo ?? []) {
    if (!region || typeof region !== "object") continue;
    for (const siteNode of region.sites ?? []) {
      if (!siteNode || typeof siteNode !== "object") continue;
      if (normalize(siteNode.id).toLowerCase() !== wanted) continue;
      collectTeslaLocationIds(siteNode, ids);
    }
  }
  return ids;
}

function teslaListingToLead(source, row, lookups) {
  const title = normalize(row.t);
  const jobId = normalize(row.id);
  const locationId = [...teslaIdSet(row.l)][0] ?? "";
  if (!title || !jobId) return null;
  const department = normalize(lookups.departments[String(row.dp)]);
  const location = normalize(lookups.locations[locationId]);
  const jobType = teslaTypeLabel(lookups.types[String(row.y)]);
  const content = normalize(`${department}\n${jobType}\n${location}`);
  const category = categorize(title, content);
  const resumeChoice = chooseResume(title, content);
  const gradMatch = graduationMatch(title, content);
  const url = teslaSlug(title, jobId);
  return {
    detected_date: new Date().toISOString().slice(0, 10),
    company: source.company,
    role_title: title,
    location,
    resume_choice: resumeChoice,
    priority: priorityFor(title, source.priority),
    direct_apply_url: url,
    career_source_url: sourceByCompany.get(source.company)?.career_url ?? source.url ?? teslaStateUrl,
    lead_status: "Tailor Resume",
    updated_at: "",
    category,
    compensation: extractCompensation(title, content, row),
    graduation_match: gradMatch,
    jd_keywords: gradMatch === "2027 grad eligible" ? ["2027 graduation window"] : [],
    fit_notes: fitNotes(title, category),
    tailoring_notes: tailoringNotes(title, category, resumeChoice),
    apply_notes: "Review after resume upload; do not submit without user confirmation.",
  };
}

async function scanTesla(source, timeoutMs = fetchTimeoutMs) {
  const url = source.url ?? teslaStateUrl;
  const payload = await fetchJson(url, timeoutMs);
  if (!payload || typeof payload !== "object" || !Array.isArray(payload.listings)) {
    throw new Error("Tesla careers state endpoint returned an unexpected payload shape");
  }
  const lookup = payload.lookup && typeof payload.lookup === "object" ? payload.lookup : {};
  const lookups = {
    departments: teslaStringLookup(lookup.departments),
    locations: teslaStringLookup(lookup.locations),
    types: teslaStringLookup(lookup.types),
  };
  const locationIds = teslaLocationIdsForSite(payload, source.site ?? "US");
  if (locationIds.size === 0) {
    throw new Error(`Tesla careers state payload did not include location ids for site=${source.site ?? "US"}`);
  }

  const leads = [];
  for (const row of payload.listings) {
    if (!row || typeof row !== "object") continue;
    const rowLocationIds = teslaIdSet(row.l);
    if (![...rowLocationIds].some((id) => locationIds.has(id))) continue;
    const lead = teslaListingToLead(source, row, lookups);
    if (!lead) continue;
    if (!isRelevant(lead.role_title, `${lead.category}\n${lead.location}`)) continue;
    if (hasOnlyExcludedGraduationWindow(lead.role_title, `${lead.category}\n${lead.location}`)) continue;
    leads.push(lead);
  }
  return leads;
}

async function scanGreenhouse(source, timeoutMs = fetchTimeoutMs) {
  const url = `https://boards-api.greenhouse.io/v1/boards/${source.board}/jobs?content=true`;
  const data = await fetchJson(url, timeoutMs);
  return (data.jobs ?? [])
    .filter((job) => isRelevant(job.title) && !hasOnlyExcludedGraduationWindow(job.title, job.content))
    .map((job) => greenhouseJobToLead(source, job));
}

async function scanLever(source, timeoutMs = fetchTimeoutMs) {
  const url = `https://api.lever.co/v0/postings/${source.site}?mode=json`;
  const jobs = await fetchJson(url, timeoutMs);
  return jobs
    .filter((job) => isRelevant(job.text) && !hasOnlyExcludedGraduationWindow(job.text, job.descriptionPlain))
    .map((job) => leverJobToLead(source, job));
}

async function scanAshby(source, timeoutMs = fetchTimeoutMs) {
  const url = `https://api.ashbyhq.com/posting-api/job-board/${source.board}`;
  const data = await fetchJson(url, timeoutMs);
  return (data.jobs ?? data.jobPostings ?? [])
    .filter((job) => isRelevant(job.title) && !hasOnlyExcludedGraduationWindow(job.title, stripHtml(job.descriptionHtml)))
    .map((job) => ashbyJobToLead(source, job));
}

async function scanWorkday(source, timeoutMs = fetchTimeoutMs) {
  const host = source.host ?? `${source.tenant}.wd1.myworkdayjobs.com`;
  const url = `https://${host}/wday/cxs/${source.tenant}/${source.site}/jobs`;
  const limit = source.limit ?? 50;
  const maxPages = source.maxPages ?? 3;
  const jobsByPath = new Map();

  for (const searchText of searchTextsFor(source)) {
    for (let page = 0; page < maxPages; page += 1) {
      const offset = page * limit;
      const data = await fetchWithRetries(url, "application/json,text/plain,*/*", (response) => response.json(), timeoutMs, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit, offset, searchText }),
      });
      const postings = Array.isArray(data.jobPostings) ? data.jobPostings : [];
      for (const job of postings) {
        if (job.externalPath) jobsByPath.set(job.externalPath, job);
      }
      const total = Number(data.total);
      if (postings.length < limit || (Number.isFinite(total) && offset + postings.length >= total)) break;
    }
  }

  const candidates = [...jobsByPath.values()].filter((job) => {
    const context = `${job.timeType ?? ""}\n${job.locationsText ?? ""}\n${(job.bulletFields ?? []).join("\n")}`;
    return isRelevant(job.title)
      && isEligibleRole(job.title, context)
      && !hasOnlyExcludedGraduationWindow(job.title, context);
  });
  const detailLimit = source.detailLimit ?? 100;
  const detailBase = `https://${host}/wday/cxs/${source.tenant}/${source.site}`;
  const enriched = await mapConcurrent(candidates.slice(0, detailLimit), htmlDetailConcurrency, async (job) => {
    try {
      const detail = await fetchJson(`${detailBase}${job.externalPath}`, timeoutMs);
      return { ...job, ...detail };
    } catch {
      return job;
    }
  });
  return enriched.map((job) => workdayJobToLead(source, job));
}

async function scanPhenom(source, timeoutMs = fetchTimeoutMs) {
  const url = source.widgetsUrl ?? `${source.baseUrl}/widgets`;
  const jobsByKey = new Map();
  for (const searchText of searchTextsFor(source)) {
    const data = await fetchWithRetries(url, "application/json,text/plain,*/*", (response) => response.json(), timeoutMs, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Origin": source.baseUrl,
        "Referer": source.referer ?? `${source.baseUrl}/global/en/search-results`,
      },
      body: JSON.stringify({
        ddoKey: "refineSearch",
        sortBy: "",
        subsearch: "",
        from: 0,
        jobs: true,
        counts: true,
        all_fields: source.allFields ?? ["category", "country", "state", "city", "type"],
        size: source.limit ?? 50,
        clearAll: false,
        jdsource: "facets",
        isSliderEnable: false,
        pageName: source.pageName ?? "search-results",
        siteType: "external",
        keywords: searchText,
        global: true,
        selected_fields: source.selectedFields ?? {},
      }),
    });
    for (const job of data.refineSearch?.data?.jobs ?? []) {
      const key = normalize(job.jobId ?? job.reqId ?? job.applyUrl ?? job.url) || `${normalize(job.title)}|${normalize(job.location)}`;
      jobsByKey.set(key, job);
    }
  }
  return [...jobsByKey.values()]
    .filter((job) => isRelevant(job.title) && !hasOnlyExcludedGraduationWindow(job.title, `${job.descriptionTeaser ?? ""}\n${job.type ?? ""}\n${job.experienceLevel ?? ""}\n${job.category ?? ""}`))
    .map((job) => phenomJobToLead(source, job));
}

async function scanAvature(source, timeoutMs = fetchTimeoutMs) {
  const limit = source.limit ?? 20;
  const jobsByUrl = new Map();
  for (const searchText of searchTextsFor(source)) {
    const query = encodeURIComponent(searchText);
    const url = `${source.baseUrl}/careers/SearchJobs/?jobRecordsPerPage=${limit}&jobOffset=0&jobSearch=${query}`;
    const html = await fetchText(url, timeoutMs, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Accept": "text/html,*/*",
      },
    });
    const cards = [...html.matchAll(/<article[\s\S]*?<\/article>/gi)].map((match) => match[0]);
    for (const card of cards) {
      const titleMatch = card.match(/<a\b[^>]*class=["'][^"']*\blink\b[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>\s*([\s\S]*?)\s*<\/a>/i)
        ?? card.match(/<a\b[^>]*href=["']([^"']+)["'][^>]*class=["'][^"']*\blink\b[^"']*["'][^>]*>\s*([\s\S]*?)\s*<\/a>/i);
      const locationMatch = card.match(/<span\b[^>]*class=["'][^"']*list-item-location[^"']*["'][^>]*>([\s\S]*?)<\/span>/i);
      const job = {
        url: absoluteHttpUrl(source.baseUrl, titleMatch?.[1]),
        title: stripHtml(titleMatch?.[2] ?? ""),
        location: stripHtml(locationMatch?.[1] ?? ""),
      };
      if (job.url) jobsByUrl.set(job.url, job);
    }
  }
  const candidates = [...jobsByUrl.values()]
    .filter((job) => isRelevant(job.title) && isEligibleRole(job.title, job.location) && !hasOnlyExcludedGraduationWindow(job.title, job.location));
  const detailLimit = source.detailLimit ?? 100;
  const enriched = await mapConcurrent(candidates.slice(0, detailLimit), htmlDetailConcurrency, async (job) => {
    try {
      const html = await fetchText(job.url, timeoutMs, { headers: { "User-Agent": "Mozilla/5.0", "Accept": "text/html,*/*" } });
      return { ...job, description: stripHtml(html) };
    } catch {
      return job;
    }
  });
  return enriched.map((job) => avatureJobToLead(source, job));
}

async function scanHtmlJobs(source, timeoutMs = fetchTimeoutMs) {
  const sourceUrls = source.urls ?? (source.url ? [source.url] : []);
  const leadByUrl = new Map();
  const detailCandidates = new Map();
  const detailLimit = source.detailLimit ?? 8;

  for (const url of sourceUrls) {
    const html = await fetchText(url, timeoutMs, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Accept": "text/html,*/*",
      },
    });
    if (source.forceDetail || isHtmlDetailUrl(source, url)) {
      const job = htmlJobFromDetail(source, url, html);
      const context = `${job.location}\n${job.description}`;
      if (isRelevant(job.title, context) && isEligibleRole(job.title, context) && !hasOnlyExcludedGraduationWindow(job.title, context)) {
        leadByUrl.set(job.url, htmlJobToLead(source, job));
      }
    }
    for (const job of htmlCardSummaries(source, url, html)) {
      const context = `${job.location}\n${job.title}`;
      if (!isRelevant(job.title, context)) continue;
      if (!isEligibleRole(job.title, context)) continue;
      if (hasOnlyExcludedGraduationWindow(job.title, context)) continue;
      detailCandidates.set(job.url, job);
    }
  }

  await mapConcurrent([...detailCandidates.values()].slice(0, detailLimit), htmlDetailConcurrency, async (job) => {
    if (leadByUrl.has(job.url)) return;
    const html = await fetchText(job.url, timeoutMs, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Accept": "text/html,*/*",
      },
    });
    const enrichedJob = htmlJobFromDetail(source, job.url, html, job);
    const context = `${enrichedJob.location}\n${enrichedJob.description}`;
    if (!isRelevant(enrichedJob.title, context)) return;
    if (!isEligibleRole(enrichedJob.title, context)) return;
    if (hasOnlyExcludedGraduationWindow(enrichedJob.title, context)) return;
    leadByUrl.set(enrichedJob.url, htmlJobToLead(source, enrichedJob));
  });

  return [...leadByUrl.values()];
}

async function scanGoogleCareers(source, timeoutMs = fetchTimeoutMs) {
  return scanHtmlJobs({
    relativeJobBase: "https://www.google.com/about/careers/applications/",
    detailUrlPatterns: ["/jobs/results/\\d+"],
    contentStartPattern: "<h3>\\s*Minimum qualifications",
    titleSuffixPattern: "\\s+(?:-|[\\u2013\\u2014])\\s+Google Careers$",
    ...source,
  }, timeoutMs);
}

function directPageToLead(target, html) {
  const text = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ");
  if (!target.monitor_queries || !text) return null;
  const queryTerms = target.monitor_queries.split(";").map((item) => item.trim()).filter(Boolean);
  const matchesConfiguredQuery = queryTerms.some((query) => new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(text));
  const hasDirectOpeningHint = /job|opening|role|position/i.test(text);
  if (!matchesConfiguredQuery || !hasDirectOpeningHint) return null;
  return {
    detected_date: new Date().toISOString().slice(0, 10),
    company: target.company,
    role_title: "Potential matching role found on career page",
    location: "",
    resume_choice: target.default_resume?.includes("AI/ML") ? "AI/ML" : "General CS/SWE",
    priority: target.priority,
    direct_apply_url: target.career_url,
    career_source_url: target.career_url,
    lead_status: "New Lead",
    updated_at: "",
    category: "Career Page Match",
    jd_keywords: target.monitor_queries?.split(";").map((item) => item.trim()).filter(Boolean) ?? [],
    fit_notes: "Career page text matched configured role queries; needs manual role-level confirmation.",
    tailoring_notes: "Open official career page, identify the exact role, then tailor only after a full job description is available.",
    apply_notes: "Discovery-only lead from direct page scan; not application-ready yet.",
  };
}

async function scanDirectPages(targets, limit, options = {}) {
  const skipKnownAts = options.skipKnownAts ?? true;
  let directTargets = targets
    .filter((target) => !skipKnownAts || !atsCompanyNames.has(target.company.toLowerCase()));
  if (Number.isFinite(limit)) {
    directTargets = directTargets.slice(0, limit);
  }

  async function scanTargets(targetSubset, timeoutMs, concurrency, phase) {
    const scanned = [];
    const leads = [];
    let nextIndex = 0;
    async function worker() {
      while (nextIndex < targetSubset.length) {
        const target = targetSubset[nextIndex];
        nextIndex += 1;
        try {
          const html = await fetchText(target.career_url, timeoutMs, directFetchInit(target));
          const lead = directPageToLead(target, html);
          scanned.push({ company: target.company, status: "ok", matched: Boolean(lead), phase });
          if (lead) leads.push(lead);
        } catch (error) {
          scanned.push({ ...(blockedDirectStatus(target, error) ?? { company: target.company, status: "error", error: error.message }), phase });
        }
      }
    }

    await Promise.all(Array.from({ length: Math.min(concurrency, targetSubset.length) }, () => worker()));
    return { leads, scanned };
  }

  const firstPass = await scanTargets(directTargets, fetchTimeoutMs, directPageConcurrency, "fast-pass");
  const retryTargets = doubleCheckErrors
    ? firstPass.scanned
      .filter((entry) => entry.status === "error" && isRetryableScanError(entry.error))
      .map((entry) => directTargets.find((target) => target.company === entry.company))
      .filter(Boolean)
    : [];

  if (retryTargets.length === 0) return firstPass;

  const doubleCheck = await scanTargets(retryTargets, doubleCheckTimeoutMs, doubleCheckConcurrency, "double-check");
  return {
    leads: [...firstPass.leads, ...doubleCheck.leads],
    scanned: [...firstPass.scanned, ...doubleCheck.scanned],
    doubleCheckAttempted: retryTargets.length,
  };
}

async function scanSource(source, timeoutMs) {
  switch (source.adapter) {
    case "greenhouse": return scanGreenhouse(source, timeoutMs);
    case "lever": return scanLever(source, timeoutMs);
    case "ashby": return scanAshby(source, timeoutMs);
    case "workday": return scanWorkday(source, timeoutMs);
    case "phenom": return scanPhenom(source, timeoutMs);
    case "avature": return scanAvature(source, timeoutMs);
    case "tesla": return scanTesla(source, timeoutMs);
    case "html_jobs": return scanHtmlJobs(source, timeoutMs);
    case "google_careers": return scanGoogleCareers(source, timeoutMs);
    default: throw new Error(`Unsupported adapter: ${source.adapter}`);
  }
}

async function scanAtsSource(source) {
    const sourceTimeoutMs = source.timeoutMs ?? fetchTimeoutMs;
    try {
      const leads = await scanSource(source, sourceTimeoutMs);
      return {
        leads,
        log: { company: source.company, adapter: source.adapter, status: "ok", matches: leads.length, phase: "fast-pass" },
      };
    } catch (error) {
      const initialError = error.message;
      if (!doubleCheckErrors || !isRetryableScanError(initialError)) {
        return {
          leads: [],
          log: sourceErrorLog(source, initialError, "fast-pass"),
        };
      }

      try {
        const retryTimeoutMs = source.doubleCheckTimeoutMs ?? doubleCheckTimeoutMs;
        const leads = await scanSource(source, retryTimeoutMs);
        return {
          leads,
          log: [
            sourceErrorLog(source, initialError, "fast-pass"),
            { company: source.company, adapter: source.adapter, status: "ok", matches: leads.length, phase: "double-check" },
          ],
        };
      } catch (retryError) {
        return {
          leads: [],
          log: [
            sourceErrorLog(source, initialError, "fast-pass"),
            sourceErrorLog(source, retryError.message, "double-check"),
          ],
        };
      }
    }
}

async function scanAtsSources(sources) {
  return mapConcurrent(sources, atsSourceConcurrency, scanAtsSource);
}

function flattenLogs(results) {
  return results.flatMap((result) => Array.isArray(result.log) ? result.log : [result.log]);
}

function terminalSourceStatuses(scanLog) {
  const latestBySource = new Map();
  for (const entry of scanLog) {
    latestBySource.set(`${entry.company}|${entry.adapter}`, entry);
  }
  return [...latestBySource.values()];
}

function normalizedErrorCategory(errorMessage) {
  const value = normalize(errorMessage);
  const status = value.match(/\b(4\d\d|5\d\d)\b/)?.[1];
  const statusLabels = {
    400: "Bad Request",
    401: "Unauthorized",
    403: "Forbidden",
    404: "Not Found",
    408: "Request Timeout",
    429: "Too Many Requests",
    500: "Internal Server Error",
    502: "Bad Gateway",
    503: "Service Unavailable",
    504: "Gateway Timeout",
  };
  if (status) return `${status} ${statusLabels[status] ?? "HTTP Error"}`;
  if (/timed?\s*out|timeout|aborted/i.test(value)) return "Request Timeout";
  if (/fetch failed|econnreset|etimedout|socket/i.test(value)) return "Network Error";
  return value || "Unknown Error";
}

function errorBreakdown(entries) {
  return entries
    .filter((entry) => entry.status === "error")
    .reduce((counts, entry) => {
      const key = normalizedErrorCategory(entry.error);
      counts[key] = (counts[key] ?? 0) + 1;
      return counts;
    }, {});
}

function dedupeLeads(existing, candidates) {
  const seen = new Set(existing.map((lead) => keyFor(lead.company, roleTitle(lead), lead.location, applyUrl(lead))));
  const fresh = [];
  for (const candidate of candidates) {
    const key = keyFor(candidate.company, roleTitle(candidate), candidate.location, applyUrl(candidate));
    if (!seen.has(key)) {
      seen.add(key);
      fresh.push(candidate);
    }
  }
  return fresh;
}

function capByCompany(leads, limit) {
  const counts = new Map();
  const capped = [];
  for (const lead of leads) {
    const count = counts.get(lead.company) ?? 0;
    if (count >= limit) continue;
    counts.set(lead.company, count + 1);
    capped.push(lead);
  }
  return capped;
}

function toPublicRole(lead, scannedAt) {
  const title = roleTitle(lead);
  const context = `${lead.graduation_match ?? ""}\n${lead.category ?? ""}\n${lead.fit_notes ?? ""}`;
  const type = roleType(title, context) || lead.role_type || "New Grad";
  const discipline = categorize(title);
  const url = applyUrl(lead);
  const existingGradWindow = normalize(lead.grad_window);
  const inferredGradWindow = internshipEligiblePatterns.some((pattern) => pattern.test(title))
    ? "2027 internship eligible"
    : (targetGradPatterns.some((pattern) => pattern.test(title)) || /\b2027\b/.test(title)
        ? "2027 grad eligible"
        : (earlyCareerPatterns.some((pattern) => pattern.test(title)) ? "Early career" : ""));
  const gradWindow = normalize(lead.graduation_match)
    || inferredGradWindow
    || existingGradWindow
    || (type === "Internship" ? "Internship" : "New grad or university grad");
  return {
    company: normalize(lead.company),
    title: normalize(title),
    location: normalize(lead.location),
    role_type: type,
    discipline,
    compensation: normalize(lead.compensation),
    grad_window: gradWindow,
    url,
    source: normalize(lead.career_source_url) || normalize(lead.source) || url,
    date_seen: lead.detected_date || scannedAt.slice(0, 10),
    last_seen: scannedAt.slice(0, 10),
    updated_at: normalize(lead.updated_at),
    priority: normalize(lead.priority) || "P1",
  };
}

function mergeRoles(existing, candidates, scannedAt) {
  const byKey = new Map();
  for (const role of existing.map((lead) => toPublicRole(lead, lead.last_seen || scannedAt))) {
    byKey.set(keyFor(role.company, role.title, role.location, role.url), role);
  }
  for (const role of candidates.map((lead) => toPublicRole(lead, scannedAt))) {
    const key = keyFor(role.company, role.title, role.location, role.url);
    const existingRole = byKey.get(key);
    byKey.set(key, {
      ...existingRole,
      ...role,
      compensation: role.compensation || existingRole?.compensation || "",
      date_seen: existingRole?.date_seen || role.date_seen,
      last_seen: scannedAt.slice(0, 10),
    });
  }
  return [...byKey.values()].sort(compareRoles);
}

function isRecentlySeen(role, scannedAt) {
  const lastSeenMs = Date.parse(role.last_seen || role.date_seen || "");
  if (Number.isNaN(lastSeenMs)) return true;
  return Date.parse(scannedAt) - lastSeenMs <= staleAfterDays * 24 * 60 * 60 * 1000;
}

function compareRoles(a, b) {
  const typeOrder = { "New Grad": 0, "Internship": 1 };
  const disciplineOrder = {
    "Software / AI / ML": 0,
    "Data Science": 1,
    "Technical Writing": 2,
    "Mechanical Engineering": 3,
    "Aerospace Engineering": 4,
    "Other": 9,
  };
  return (typeOrder[a.role_type] ?? 9) - (typeOrder[b.role_type] ?? 9)
    || (disciplineOrder[a.discipline] ?? 9) - (disciplineOrder[b.discipline] ?? 9)
    || a.company.localeCompare(b.company)
    || a.title.localeCompare(b.title)
    || a.location.localeCompare(b.location);
}

function csvEscape(value) {
  let text = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function rolesToCsv(roles) {
  const columns = ["company", "title", "location", "role_type", "discipline", "compensation", "grad_window", "url", "source", "date_seen", "last_seen", "updated_at", "priority"];
  return [
    columns.join(","),
    ...roles.map((role) => columns.map((column) => csvEscape(role[column])).join(",")),
  ].join("\n") + "\n";
}

function markdownLink(label, url) {
  if (!isHttpUrl(url)) return label;
  return `[${label}](<${String(url).replace(/>/g, "%3E")}>)`;
}

function markdownEscape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\|/g, "\\|")
    .replace(/\n/g, " ");
}

function renderTable(roles) {
  if (roles.length === 0) return "_No roles found yet._\n";
  const lines = [
    "| Company | Role | Location | Salary / Hourly | Grad Window | Posted/Seen | Apply |",
    "|---|---|---|---|---|---|---|",
  ];
  for (const role of roles) {
    lines.push(`| ${markdownEscape(role.company)} | ${markdownEscape(role.title)} | ${markdownEscape(role.location)} | ${markdownEscape(role.compensation || "-")} | ${markdownEscape(role.grad_window)} | ${markdownEscape(role.date_seen)} | ${markdownLink("Apply", role.url)} |`);
  }
  return `${lines.join("\n")}\n`;
}

function formatReadmeTimestamp(value) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return "Not scanned yet";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}

function renderReadme(roles, coverage, freshCount) {
  const disciplines = ["Software / AI / ML", "Data Science", "Technical Writing", "Mechanical Engineering", "Aerospace Engineering", "Other"];
  const sections = [];
  for (const roleTypeName of ["New Grad", "Internship"]) {
    sections.push(`## ${roleTypeName} Roles\n`);
    for (const discipline of disciplines) {
      const matching = roles.filter((role) => role.role_type === roleTypeName && role.discipline === discipline);
      if (matching.length === 0 && discipline === "Other") continue;
      sections.push(`### ${discipline}\n\n${renderTable(matching)}`);
    }
  }
  return `# New Grad and Internship Roles 2027

Public, GitHub Actions-powered tracker for 2027 new grad and internship roles.

Tracked disciplines:

- Software / AI / ML
- Data Science
- Technical Writing
- Mechanical Engineering
- Aerospace Engineering

This board is generated from official company career pages and ATS pages where possible. It is intended for discovery only; always verify the posting on the company site before applying.

[Contributors](CONTRIBUTORS.md)

Last updated: ${formatReadmeTimestamp(coverage.scanned_at)}

Companies tracked: ${coverage.companies_in_target_list}

Current roles: ${roles.length}

Fresh roles this scan: ${freshCount}

${sections.join("\n")}

## Data Files

- [data/roles.json](data/roles.json)
- [data/roles.csv](data/roles.csv)
- [data/latest_scan.json](data/latest_scan.json)
- [data/coverage.json](data/coverage.json)
- [docs/ADDING_SOURCES.md](docs/ADDING_SOURCES.md)

## Notes

- This repository does not submit applications.
- Personal application status, resumes, and private notes should not be committed here.
- Salary/hourly data is extracted only when the official posting text exposes it.
- Non-ATS official pages can use the config-driven \`html_jobs\` adapter with detail URL patterns.
- Roles not seen for ${staleAfterDays} days are automatically removed from the public board.
- Generated files are updated by \`.github/workflows/monitor.yml\`.
`;
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertTruthy(value, label) {
  if (!value) throw new Error(`${label}: expected truthy value`);
}

function assertThrows(callback, pattern, label) {
  try {
    callback();
  } catch (error) {
    if (pattern.test(error.message)) return;
    throw new Error(`${label}: threw unexpected error ${JSON.stringify(error.message)}`);
  }
  throw new Error(`${label}: expected callback to throw`);
}

async function runSelfTests() {
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
  assertEqual(csvEscape("=HYPERLINK(\"bad\")"), "\"'=HYPERLINK(\"\"bad\"\")\"", "CSV formula neutralization");
  assertEqual(normalizedErrorCategory("404 NOT FOUND"), "404 Not Found", "stable HTTP error category");
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

if (process.argv.includes("--self-test")) {
  await runSelfTests();
  console.log("monitor self-test ok");
  process.exit(0);
}

await fs.mkdir(dataDir, { recursive: true });
const targets = await readJson(targetPath, []);
const atsSources = await readJson(sourcePath, []);
const existingLeads = await readJson(roleDataPath, []);
validateConfiguration(targets, atsSources);
if (!Array.isArray(existingLeads)) throw new Error("data/roles.json must contain a JSON array");
for (const target of targets) {
  sourceByCompany.set(target.company, target);
}
for (const source of atsSources) {
  atsCompanyNames.add(source.company.toLowerCase());
}

const allCandidates = [];
const scanLog = [];
const directLimit = process.env.DIRECT_PAGE_LIMIT
  ? envInteger("DIRECT_PAGE_LIMIT", 0, { min: 1, max: targets.length })
  : Number.POSITIVE_INFINITY;
const directScanPromise = scanDirectPages(targets, directLimit);
const atsScan = await scanAtsSources(atsSources);
allCandidates.push(...atsScan.flatMap((result) => result.leads));
scanLog.push(...flattenLogs(atsScan));
const failedAtsCompanies = new Set(
  terminalSourceStatuses(scanLog)
    .filter((entry) => entry.status === "error")
    .map((entry) => entry.company.toLowerCase()),
);
const failedAtsTargets = targets.filter((target) => failedAtsCompanies.has(target.company.toLowerCase()));
const fallbackDirectScanPromise = failedAtsTargets.length > 0
  ? scanDirectPages(failedAtsTargets, Number.POSITIVE_INFINITY, { skipKnownAts: false })
  : Promise.resolve({ leads: [], scanned: [] });
const [directScan, fallbackDirectScan] = await Promise.all([directScanPromise, fallbackDirectScanPromise]);
const combinedDirectScan = {
  leads: [...directScan.leads, ...fallbackDirectScan.leads],
  scanned: [...directScan.scanned, ...fallbackDirectScan.scanned],
};
if (includeDirectPageLeads) {
  allCandidates.push(...combinedDirectScan.leads);
}
scanLog.push(...combinedDirectScan.scanned.map((item) => ({ ...item, adapter: "direct-page" })));

const boardEligibleCandidates = allCandidates
  .filter(isFreshEnough)
  .filter(isAllowedLocation)
  .filter((lead) => lead.priority !== "P2")
  .sort((a, b) => {
    const priorityRank = { P0: 0, P1: 1, P2: 2 };
    const priorityDiff = (priorityRank[a.priority] ?? 9) - (priorityRank[b.priority] ?? 9);
    if (priorityDiff !== 0) return priorityDiff;
    const gradDiff = (b.graduation_match === "2027 grad eligible" ? 1 : 0) - (a.graduation_match === "2027 grad eligible" ? 1 : 0);
    if (gradDiff !== 0) return gradDiff;
    return Date.parse(b.updated_at || "0") - Date.parse(a.updated_at || "0");
  });
const freshLeads = capByCompany(dedupeLeads(existingLeads, boardEligibleCandidates), maxNewPerCompany);

const scannedAt = new Date().toISOString();
const finalSourceStatuses = terminalSourceStatuses(scanLog);
const finalAtsStatuses = finalSourceStatuses.filter((entry) => entry.adapter !== "direct-page");
const atsOkSources = finalAtsStatuses.filter((entry) => entry.status === "ok").length;
const atsSuccessPercent = finalAtsStatuses.length === 0 ? 0 : Math.round((atsOkSources / finalAtsStatuses.length) * 1000) / 10;
const coverage = {
  scanned_at: scannedAt,
  elapsed_ms: Date.now() - startedAt,
  companies_in_target_list: targets.length,
  ats_sources_configured: atsSources.length,
  direct_sources_attempted: new Set(combinedDirectScan.scanned.map((entry) => entry.company)).size,
  double_check_enabled: doubleCheckErrors,
  double_check_attempts: scanLog.filter((entry) => entry.phase === "double-check").length,
  unique_sources_attempted: finalSourceStatuses.length,
  total_fetch_attempts: scanLog.length,
  ok_sources: finalSourceStatuses.filter((entry) => entry.status === "ok").length,
  error_sources: finalSourceStatuses.filter((entry) => entry.status === "error").length,
  blocked_sources: finalSourceStatuses.filter((entry) => entry.status === "blocked").length,
  ats_ok_sources: atsOkSources,
  ats_error_sources: finalAtsStatuses.filter((entry) => entry.status === "error").length,
  ats_blocked_sources: finalAtsStatuses.filter((entry) => entry.status === "blocked").length,
  ats_success_percent: atsSuccessPercent,
  minimum_ats_success_percent: minAtsSuccessPercent,
  error_breakdown: errorBreakdown(finalSourceStatuses),
  board_eligible_candidates: boardEligibleCandidates.length,
  stale_after_days: staleAfterDays,
  unattempted_companies: targets
    .filter((target) => !scanLog.some((entry) => entry.company === target.company))
    .map((target) => target.company),
};
const publicFreshLeads = freshLeads.map((lead) => toPublicRole(lead, scannedAt));
const updatedLeads = mergeRoles(existingLeads, boardEligibleCandidates, scannedAt)
  .filter((role) => isRecentlySeen(role, scannedAt))
  .filter(isFreshEnough)
  .filter(isAllowedLocation)
  .filter((role) => role.priority !== "P2");
await fs.writeFile(roleDataPath, `${JSON.stringify(updatedLeads, null, 2)}\n`, "utf8");
await fs.writeFile(csvOutputPath, rolesToCsv(updatedLeads), "utf8");
await fs.writeFile(scanOutputPath, `${JSON.stringify({ scanned_at: scannedAt, fresh_leads: publicFreshLeads, scan_log: scanLog, coverage }, null, 2)}\n`, "utf8");
await fs.writeFile(coverageOutputPath, `${JSON.stringify(coverage, null, 2)}\n`, "utf8");
await fs.writeFile(readmePath, renderReadme(updatedLeads, coverage, publicFreshLeads.length), "utf8");

console.log(JSON.stringify({
  scanned_at: scannedAt,
  elapsed_ms: Date.now() - startedAt,
  companies_in_target_list: targets.length,
  ats_sources: atsSources.length,
  direct_pages_scanned: coverage.direct_sources_attempted,
  double_check_attempts: coverage.double_check_attempts,
  unique_sources_attempted: coverage.unique_sources_attempted,
  total_fetch_attempts: coverage.total_fetch_attempts,
  ok_sources: coverage.ok_sources,
  error_sources: coverage.error_sources,
  blocked_sources: coverage.blocked_sources,
  unattempted_companies: coverage.unattempted_companies.length,
  candidates: allCandidates.length,
  current_roles: updatedLeads.length,
  fresh_leads: publicFreshLeads.length,
  fresh: publicFreshLeads.slice(0, 10).map((lead) => ({
    company: lead.company,
    title: lead.title,
    location: lead.location,
    role_type: lead.role_type,
    discipline: lead.discipline,
    priority: lead.priority,
    url: lead.url,
  })),
  truncated_fresh_output: publicFreshLeads.length > 10,
}, null, 2));
if (atsSuccessPercent < minAtsSuccessPercent) {
  console.error(`ATS source success rate ${atsSuccessPercent}% is below the required ${minAtsSuccessPercent}%`);
  process.exit(1);
}
process.exit(0);
