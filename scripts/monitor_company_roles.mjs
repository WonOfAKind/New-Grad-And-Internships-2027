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
const recentDays = Number.parseInt(process.env.RECENT_DAYS ?? "7", 10);
const includeDirectPageLeads = process.env.INCLUDE_DIRECT_PAGE_LEADS === "1";
const maxNewPerCompany = Number.parseInt(process.env.MAX_NEW_PER_COMPANY ?? "20", 10);
const startedAt = Date.now();
const fetchTimeoutMs = Number.parseInt(process.env.FETCH_TIMEOUT_MS ?? "7000", 10);
const fetchRetries = Number.parseInt(process.env.FETCH_RETRIES ?? "0", 10);
const directPageConcurrency = Number.parseInt(process.env.DIRECT_PAGE_CONCURRENCY ?? "48", 10);
const doubleCheckErrors = process.env.DOUBLE_CHECK_ERRORS !== "0";
const doubleCheckTimeoutMs = Number.parseInt(process.env.DOUBLE_CHECK_TIMEOUT_MS ?? "15000", 10);
const doubleCheckConcurrency = Number.parseInt(process.env.DOUBLE_CHECK_CONCURRENCY ?? "16", 10);
const userAgent = "Mozilla/5.0 (compatible; Codex new-grad role monitor)";

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
  /quant(?:itative)?\s+(?:developer|engineer)/i,
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

const excludedLocationPatterns = [
  /canada|toronto|vancouver|montreal|ottawa/i,
  /mexico|brazil|argentina|chile|colombia/i,
  /india|bengaluru|bangalore/i,
  /singapore/i,
  /sydney|australia/i,
  /seoul|south korea/i,
  /london|dublin|ireland|united kingdom|uk\b/i,
  /germany|france|japan|poland|romania/i,
];

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

function keyFor(company, title, location, url = "") {
  const normalizedUrl = normalize(url).toLowerCase();
  if (normalizedUrl) return `url|${normalizedUrl}`;
  return `${normalize(company).toLowerCase()}|${normalize(title).replace(/\s+/g, " ").toLowerCase()}|${normalize(location).toLowerCase()}`;
}

function roleTitle(lead) {
  return lead.role_title ?? lead.title ?? "";
}

function applyUrl(lead) {
  return lead.direct_apply_url ?? lead.url ?? "";
}

function isRelevant(title, text = "") {
  const haystack = `${title}\n${text}`;
  return titleRolePatterns.some((pattern) => pattern.test(haystack));
}

function isProbablySenior(title) {
  return seniorPatterns.some((pattern) => pattern.test(title));
}

function graduationMatch(title, text = "") {
  const haystack = `${title}\n${text}`;
  if (targetGradPatterns.some((pattern) => pattern.test(haystack))) return "2027 grad eligible";
  if (internshipPatterns.some((pattern) => pattern.test(haystack)) && internshipEligiblePatterns.some((pattern) => pattern.test(haystack))) return "2027 internship eligible";
  if (/new\s+grad|university\s+grad/i.test(haystack)) return "New grad or university grad";
  if (internshipPatterns.some((pattern) => pattern.test(haystack))) return "Internship";
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
  if (internshipPatterns.some((pattern) => pattern.test(haystack))) return "Internship";
  if (fullTimeNewGradPatterns.some((pattern) => pattern.test(haystack))) return "New Grad";
  return "";
}

function isEligibleRole(title, text = "") {
  const haystack = `${title}\n${text}`;
  if (hasOnlyExcludedGraduationWindow(title, text)) return false;
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
  if (targetGradPatterns.some((pattern) => pattern.test(title))) return "P0";
  if (internshipEligiblePatterns.some((pattern) => pattern.test(title))) return "P0";
  if (/new\s+grad|university\s+grad|graduate\s+\w+\s+engineer/i.test(title)) return "P0";
  if (isProbablySenior(title)) return "P2";
  return sourcePriority ?? "P1";
}

function isFreshEnough(lead) {
  const title = roleTitle(lead);
  const context = `${lead.graduation_match ?? ""}\n${lead.category ?? ""}\n${lead.fit_notes ?? ""}\n${lead.role_type ?? ""}\n${lead.discipline ?? ""}`;
  if (excludedDirectApplyUrls.has(normalize(applyUrl(lead)))) return false;
  if (!isEligibleRole(title, context)) return false;
  if (/2027/.test(lead.graduation_match ?? "")) return true;
  if (/\b(?:new\s+grad(?:uate)?|university\s+grad(?:uate)?|graduate\s+\w+\s+engineer)\b/i.test(title)) return true;
  if (!lead.updated_at) return false;
  const updatedAt = Date.parse(lead.updated_at);
  if (Number.isNaN(updatedAt)) return false;
  const ageMs = Date.now() - updatedAt;
  return ageMs <= recentDays * 24 * 60 * 60 * 1000;
}

function isAllowedLocation(lead) {
  const location = lead.location ?? "";
  return !excludedLocationPatterns.some((pattern) => pattern.test(location));
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

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
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
        throw new Error(`${response.status} ${response.statusText}`);
      }
      const body = await readBody(response);
      clearTimeout(timeout);
      return body;
    } catch (error) {
      clearTimeout(timeout);
      lastError = error;
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

async function withTimeout(promise, label, timeoutMs = fetchTimeoutMs) {
  let timeout;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`timeout: ${label}`)), timeoutMs + 1000);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

function isRetryableScanError(errorMessage = "") {
  return /aborted|timeout|fetch failed|429|too many requests|econnreset|etimedout|socket/i.test(errorMessage);
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
  const content = normalize(job.descriptionPlain);
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
    graduation_match: gradMatch,
    jd_keywords: gradMatch === "2027 grad eligible" ? ["2027 graduation window"] : [],
    fit_notes: fitNotes(title, category),
    tailoring_notes: tailoringNotes(title, category, resumeChoice),
    apply_notes: "Review after resume upload; do not submit without user confirmation.",
  };
}

function workdayJobToLead(source, job) {
  const title = normalize(job.title);
  const location = normalize(job.locationsText);
  const content = normalize(`${job.title ?? ""}\n${job.timeType ?? ""}\n${job.locationsText ?? ""}\n${(job.bulletFields ?? []).join("\n")}`);
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
    updated_at: job.postedOn ?? "",
    category,
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
    direct_apply_url: job.applyUrl ?? job.url ?? sourceByCompany.get(source.company)?.career_url,
    career_source_url: sourceByCompany.get(source.company)?.career_url ?? job.applyUrl ?? job.url,
    lead_status: "Tailor Resume",
    updated_at: job.postedDate ?? job.dateCreated ?? "",
    category,
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
  const content = normalize(`${job.title ?? ""}\n${job.location ?? ""}`);
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
    graduation_match: gradMatch,
    jd_keywords: gradMatch === "2027 grad eligible" ? ["2027 graduation window"] : [],
    fit_notes: fitNotes(title, category),
    tailoring_notes: tailoringNotes(title, category, resumeChoice),
    apply_notes: "Review after resume upload; do not submit without user confirmation.",
  };
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
  const data = await fetchWithRetries(url, "application/json,text/plain,*/*", (response) => response.json(), timeoutMs, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      limit: source.limit ?? 100,
      offset: 0,
      searchText: source.searchText ?? "software engineer",
    }),
  });
  return (data.jobPostings ?? [])
    .filter((job) => isRelevant(job.title) && !hasOnlyExcludedGraduationWindow(job.title, `${job.timeType ?? ""}\n${job.locationsText ?? ""}\n${(job.bulletFields ?? []).join("\n")}`))
    .map((job) => workdayJobToLead(source, job));
}

async function scanPhenom(source, timeoutMs = fetchTimeoutMs) {
  const url = source.widgetsUrl ?? `${source.baseUrl}/widgets`;
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
      keywords: source.searchText ?? "software engineer",
      global: true,
      selected_fields: source.selectedFields ?? {},
    }),
  });
  const jobs = data.refineSearch?.data?.jobs ?? [];
  return jobs
    .filter((job) => isRelevant(job.title) && !hasOnlyExcludedGraduationWindow(job.title, `${job.descriptionTeaser ?? ""}\n${job.type ?? ""}\n${job.experienceLevel ?? ""}\n${job.category ?? ""}`))
    .map((job) => phenomJobToLead(source, job));
}

async function scanAvature(source, timeoutMs = fetchTimeoutMs) {
  const query = encodeURIComponent(source.searchText ?? "software engineer");
  const limit = source.limit ?? 20;
  const url = `${source.baseUrl}/careers/SearchJobs/?jobRecordsPerPage=${limit}&jobOffset=0&jobSearch=${query}`;
  const html = await fetchText(url, timeoutMs, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      "Accept": "text/html,*/*",
    },
  });
  const cards = [...html.matchAll(/<article[\s\S]*?<\/article>/gi)].map((match) => match[0]);
  return cards
    .map((card) => {
      const titleMatch = card.match(/<a class="link" href="([^"]+)">\s*([\s\S]*?)\s*<\/a>/);
      const locationMatch = card.match(/<span class="list-item-location">([\s\S]*?)<\/span>/);
      return {
        url: titleMatch?.[1],
        title: stripHtml(titleMatch?.[2] ?? ""),
        location: stripHtml(locationMatch?.[1] ?? ""),
      };
    })
    .filter((job) => job.url && isRelevant(job.title) && !hasOnlyExcludedGraduationWindow(job.title, job.location))
    .map((job) => avatureJobToLead(source, job));
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
          const html = await withTimeout(fetchText(target.career_url, timeoutMs, directFetchInit(target)), target.company, timeoutMs);
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

async function scanAtsSources(sources) {
  return Promise.all(sources.map(async (source) => {
    const sourceTimeoutMs = source.timeoutMs ?? fetchTimeoutMs;
    try {
      const leadPromise =
        source.adapter === "greenhouse"
          ? scanGreenhouse(source, sourceTimeoutMs)
          : source.adapter === "lever"
            ? scanLever(source, sourceTimeoutMs)
            : source.adapter === "ashby"
              ? scanAshby(source, sourceTimeoutMs)
              : source.adapter === "workday"
                ? scanWorkday(source, sourceTimeoutMs)
                : source.adapter === "phenom"
                  ? scanPhenom(source, sourceTimeoutMs)
                  : source.adapter === "avature"
                    ? scanAvature(source, sourceTimeoutMs)
                    : Promise.resolve([]);
      const leads = await withTimeout(leadPromise, `${source.company} ${source.adapter}`, sourceTimeoutMs);
      return {
        leads,
        log: { company: source.company, adapter: source.adapter, status: "ok", matches: leads.length, phase: "fast-pass" },
      };
    } catch (error) {
      const initialError = error.message;
      if (!doubleCheckErrors || !isRetryableScanError(initialError)) {
        return {
          leads: [],
          log: { company: source.company, adapter: source.adapter, status: "error", error: initialError, phase: "fast-pass" },
        };
      }

      try {
        const retryTimeoutMs = source.doubleCheckTimeoutMs ?? doubleCheckTimeoutMs;
        const leadPromise =
          source.adapter === "greenhouse"
            ? scanGreenhouse(source, retryTimeoutMs)
            : source.adapter === "lever"
              ? scanLever(source, retryTimeoutMs)
              : source.adapter === "ashby"
                ? scanAshby(source, retryTimeoutMs)
                : source.adapter === "workday"
                  ? scanWorkday(source, retryTimeoutMs)
                  : source.adapter === "phenom"
                    ? scanPhenom(source, retryTimeoutMs)
                    : source.adapter === "avature"
                      ? scanAvature(source, retryTimeoutMs)
                      : Promise.resolve([]);
        const leads = await withTimeout(leadPromise, `${source.company} ${source.adapter} double-check`, retryTimeoutMs);
        return {
          leads,
          log: [
            { company: source.company, adapter: source.adapter, status: "error", error: initialError, phase: "fast-pass" },
            { company: source.company, adapter: source.adapter, status: "ok", matches: leads.length, phase: "double-check" },
          ],
        };
      } catch (retryError) {
        return {
          leads: [],
          log: [
            { company: source.company, adapter: source.adapter, status: "error", error: initialError, phase: "fast-pass" },
            { company: source.company, adapter: source.adapter, status: "error", error: retryError.message, phase: "double-check" },
          ],
        };
      }
    }
  }));
}

function flattenLogs(results) {
  return results.flatMap((result) => Array.isArray(result.log) ? result.log : [result.log]);
}

function uniqueAttemptedCompanies(scanLog) {
  return new Set(scanLog.map((entry) => entry.company)).size;
}

function terminalSourceStatuses(scanLog) {
  const latestBySource = new Map();
  for (const entry of scanLog) {
    latestBySource.set(`${entry.company}|${entry.adapter}`, entry);
  }
  return [...latestBySource.values()];
}

function errorBreakdown(entries) {
  return entries
    .filter((entry) => entry.status === "error")
    .reduce((counts, entry) => {
      const key = entry.error ?? "unknown";
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
    : (targetGradPatterns.some((pattern) => pattern.test(title)) || /\b2027\b/.test(title) ? "2027 grad eligible" : "");
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
    grad_window: gradWindow,
    url,
    source: normalize(lead.career_source_url) || normalize(lead.source) || url,
    date_seen: lead.detected_date || scannedAt.slice(0, 10),
    last_seen: scannedAt.slice(0, 10),
    updated_at: normalize(lead.updated_at),
    priority: normalize(lead.priority) || "P1",
  };
}

function mergeRoles(existing, fresh, scannedAt) {
  const byKey = new Map();
  for (const role of existing.map((lead) => toPublicRole(lead, lead.last_seen || scannedAt))) {
    byKey.set(keyFor(role.company, role.title, role.location, role.url), role);
  }
  for (const role of fresh.map((lead) => toPublicRole(lead, scannedAt))) {
    byKey.set(keyFor(role.company, role.title, role.location, role.url), role);
  }
  return [...byKey.values()].sort(compareRoles);
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
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function rolesToCsv(roles) {
  const columns = ["company", "title", "location", "role_type", "discipline", "grad_window", "url", "source", "date_seen", "last_seen", "updated_at", "priority"];
  return [
    columns.join(","),
    ...roles.map((role) => columns.map((column) => csvEscape(role[column])).join(",")),
  ].join("\n") + "\n";
}

function markdownLink(label, url) {
  return url ? `[${label}](${url})` : label;
}

function markdownEscape(value) {
  return String(value ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function renderTable(roles) {
  if (roles.length === 0) return "_No roles found yet._\n";
  const lines = [
    "| Company | Role | Location | Grad Window | Posted/Seen | Apply |",
    "|---|---|---|---|---|---|",
  ];
  for (const role of roles) {
    lines.push(`| ${markdownEscape(role.company)} | ${markdownEscape(role.title)} | ${markdownEscape(role.location)} | ${markdownEscape(role.grad_window)} | ${markdownEscape(role.date_seen)} | ${markdownLink("Apply", role.url)} |`);
  }
  return `${lines.join("\n")}\n`;
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

Last scan: ${coverage.scanned_at}

Companies tracked: ${coverage.companies_in_target_list}

Current roles: ${roles.length}

Fresh roles this scan: ${freshCount}

${sections.join("\n")}

## Data Files

- [data/roles.json](data/roles.json)
- [data/roles.csv](data/roles.csv)
- [data/latest_scan.json](data/latest_scan.json)
- [data/coverage.json](data/coverage.json)

## Notes

- This repository does not submit applications.
- Personal application status, resumes, and private notes should not be committed here.
- Generated files are updated by \`.github/workflows/monitor.yml\`.
`;
}

await fs.mkdir(dataDir, { recursive: true });
const targets = await readJson(targetPath, []);
const atsSources = await readJson(sourcePath, []);
const existingLeads = await readJson(roleDataPath, []);
for (const target of targets) {
  sourceByCompany.set(target.company, target);
}
for (const source of atsSources) {
  atsCompanyNames.add(source.company.toLowerCase());
}

const allCandidates = [];
const scanLog = [];
const directLimit = process.env.DIRECT_PAGE_LIMIT ? Number.parseInt(process.env.DIRECT_PAGE_LIMIT, 10) : Number.POSITIVE_INFINITY;
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

const freshLeads = capByCompany(dedupeLeads(existingLeads, allCandidates)
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
  }), maxNewPerCompany);

const scannedAt = new Date().toISOString();
const finalSourceStatuses = terminalSourceStatuses(scanLog);
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
  error_breakdown: errorBreakdown(finalSourceStatuses),
  unattempted_companies: targets
    .filter((target) => !scanLog.some((entry) => entry.company === target.company))
    .map((target) => target.company),
};
const publicFreshLeads = freshLeads.map((lead) => toPublicRole(lead, scannedAt));
const updatedLeads = mergeRoles(existingLeads, freshLeads, scannedAt);
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
process.exit(0);
