import {
  aiPatterns,
  defaultSearchTexts,
  earlyCareerPatterns,
  explicitNewGradPatterns,
  excludedDegreeProgramPatterns,
  excludedDirectApplyUrls,
  excludedGradWindowPatterns,
  excludedLocationPatterns,
  explicitUnitedStatesLocationPatterns,
  fullTimeNewGradPatterns,
  internshipEligiblePatterns,
  internshipPatterns,
  namedUnitedStatesStatePattern,
  newGrad2027StartPatterns,
  recentDays,
  seniorPatterns,
  targetGradPatterns,
  titleRolePatterns,
} from "./config.mjs";

export function normalize(value) {
  return String(value ?? "").trim();
}

export function normalizeDisplayText(value) {
  return normalize(value)
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#x27;|&#39;/gi, "'")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeCompanyName(value) {
  const cleaned = normalizeDisplayText(value).replace(/^[↳→]\s*/, "").replace(/[✓✅🔒]+/g, "").replace(/\s+/g, " ").trim();
  if (/^IMC$/i.test(cleaned)) return "IMC Trading";
  if (/^Chevron Corporation$/i.test(cleaned)) return "Chevron";
  if (/^Old Mission$/i.test(cleaned)) return "Old Mission Capital";
  if (/^Tower Research$/i.test(cleaned)) return "Tower Research Capital";
  if (/^Base Power Company$/i.test(cleaned)) return "Base Power";
  if (/^SEL \(Schweitzer Engineering Laboratories\)$/i.test(cleaned)) return "Schweitzer Engineering Laboratories";
  if (/^Susquehanna$/i.test(cleaned)) return "Susquehanna International Group";
  return cleaned;
}

export function normalizeRoleTitle(value) {
  return normalizeDisplayText(value).replace(/[🆕🛂✅🔒✓]+|\p{Regional_Indicator}{2}/gu, "").replace(/\s+/g, " ").trim();
}

export function withoutSyntheticCycleEvidence(value) {
  return normalize(value)
    .replace(/\b2027\s+new\s+grad\s+recruiting\s+cycle\b/gi, " ")
    .replace(/\b2027\s+internship\s+cycle\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function dateOnly(value) {
  const text = normalize(value);
  if (!text) return "";
  const direct = /^(\d{4}-\d{2}-\d{2})$/.exec(text)?.[1];
  if (direct) return direct;
  const parsed = Date.parse(text);
  if (Number.isNaN(parsed)) return "";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(parsed));
  const part = (type) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function normalizePostingDate(value, observedAt = new Date().toISOString()) {
  const text = normalize(value);
  if (!text) return "";
  const observedOn = dateOnly(observedAt);
  const observed = new Date(`${observedOn}T00:00:00Z`);
  if (!observedOn || Number.isNaN(observed.getTime())) return dateOnly(text);
  const relative = text.match(/(?:posted\s+)?(\d+)\s+days?\s+ago/i);
  if (/\bposted\s+today\b/i.test(text)) return observed.toISOString().slice(0, 10);
  if (/\bposted\s+yesterday\b/i.test(text)) {
    observed.setUTCDate(observed.getUTCDate() - 1);
    return observed.toISOString().slice(0, 10);
  }
  if (relative && !/\d+\s*\+\s*days?/i.test(text)) {
    observed.setUTCDate(observed.getUTCDate() - Number(relative[1]));
    return observed.toISOString().slice(0, 10);
  }
  return dateOnly(text);
}

export function isExpiredDate(value, comparedAt = new Date().toISOString()) {
  const expiresOn = dateOnly(value);
  const comparedOn = dateOnly(comparedAt);
  if (!expiresOn || !comparedOn) return false;
  return expiresOn < comparedOn;
}

export function absoluteHttpUrl(baseUrl, value) {
  const candidate = normalize(value);
  if (!candidate) return "";
  try {
    const resolved = new URL(candidate, baseUrl);
    return ["http:", "https:"].includes(resolved.protocol) ? resolved.toString() : "";
  } catch {
    return "";
  }
}

export function searchTextsFor(source) {
  const configured = Array.isArray(source.searchTexts) && source.searchTexts.length > 0
    ? source.searchTexts
    : [source.searchText, ...defaultSearchTexts];
  return [...new Set(configured.map(normalize).filter(Boolean))];
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function mapConcurrent(items, concurrency, mapper) {
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

export function canonicalApplyUrl(url) {
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
    const smartRecruiters = parsed.pathname.match(/^\/v1\/companies\/([^/]+)\/postings\/([^/]+)$/i);
    if (/^api\.smartrecruiters\.com$/i.test(parsed.hostname) && smartRecruiters) {
      return `https://jobs.smartrecruiters.com/${smartRecruiters[1]}/${smartRecruiters[2]}`;
    }
    if (parsed.pathname !== "/") parsed.pathname = parsed.pathname.replace(/\/+$/, "");
    return parsed.toString();
  } catch {
    return value;
  }
}

export function stableJobIdentity(url) {
  try {
    const parsed = new URL(canonicalApplyUrl(url));
    const queryId = parsed.searchParams.get("gh_jid")
      || parsed.searchParams.get("jobId")
      || parsed.searchParams.get("job_id")
      || parsed.searchParams.get("reqId")
      || parsed.searchParams.get("req_id");
    const pathId = /\/(?:jobs?|details)\/(\d{4,})(?:\/|$)/i.exec(parsed.pathname)?.[1]
      || /\/job\/(\d{4,})(?:\/|$)/i.exec(parsed.pathname)?.[1]
      || /\/([0-9a-f]{8}-[0-9a-f-]{27,})(?:\/|$)/i.exec(parsed.pathname)?.[1]
      || /_([A-Z]{0,8}\d[\w-]*)(?:\/apply)?\/?$/i.exec(parsed.pathname)?.[1];
    return normalize(queryId || pathId).toLowerCase();
  } catch {
    return "";
  }
}

export function keyFor(company, title, location, url = "") {
  const normalizedUrl = canonicalApplyUrl(url).toLowerCase();
  const stableId = stableJobIdentity(normalizedUrl);
  if (stableId) return `job|${normalizeCompanyName(company).toLowerCase()}|${stableId}`;
  if (normalizedUrl) return `url|${normalizedUrl}`;
  return `${normalizeCompanyName(company).toLowerCase()}|${normalizeRoleTitle(title).toLowerCase()}|${normalize(location).toLowerCase()}`;
}

export function roleTitle(lead) {
  return normalizeRoleTitle(lead.role_title ?? lead.title ?? "");
}

export function applyUrl(lead) {
  return canonicalApplyUrl(lead.direct_apply_url ?? lead.url ?? "");
}

export function isDirectEmployerApplyUrl(value) {
  try {
    const hostname = new URL(canonicalApplyUrl(value)).hostname;
    return !/(^|\.)(?:ripplematch\.com|joinhandshake\.com|handshake\.com|wayup\.com|linkedin\.com|indeed\.com|glassdoor\.com|simplify\.jobs|zapplyjobs\.com|speedyapply\.com)$/i.test(hostname);
  } catch {
    return false;
  }
}

export function isRelevant(title) {
  if (/\b(?:recruiter|recruiting|talent\s+acquisition|human\s+resources?)\b/i.test(title)) return false;
  if (/\b(?:private\s+equity|investment\s+(?:associate|banking|analyst)|wealth\s+management)\b/i.test(title)) return false;
  if (/\bproduct\s+management\b|\bproduct\s+manager\b/i.test(title)) return false;
  if (/\boperations?\s+(?:intern|internship|co[-\s]?op)\b/i.test(title) && !/engineer|technical/i.test(title)) return false;
  return titleRolePatterns.some((pattern) => pattern.test(title));
}

export function isProbablySenior(title) {
  return seniorPatterns.some((pattern) => pattern.test(title));
}

export function hasExcludedDegreeProgram(title) {
  return excludedDegreeProgramPatterns.some((pattern) => pattern.test(title));
}

export function graduationMatch(title, text = "") {
  const haystack = `${title}\n${text}`;
  if (targetGradPatterns.some((pattern) => pattern.test(haystack))) return "2027 grad eligible";
  if (newGrad2027StartPatterns.some((pattern) => pattern.test(haystack))) return "Summer 2027 start";
  if (internshipPatterns.some((pattern) => pattern.test(title)) && internshipEligiblePatterns.some((pattern) => pattern.test(haystack))) return "2027 internship eligible";
  if (explicitNewGradPatterns.some((pattern) => pattern.test(haystack))) return "Explicit new grad role";
  if (earlyCareerPatterns.some((pattern) => pattern.test(haystack))) return "Early career";
  if (internshipPatterns.some((pattern) => pattern.test(title))) return "Internship";
  return "";
}

export function hasOnlyExcludedGraduationWindow(title, text = "") {
  const haystack = `${title}\n${text}`;
  if (/\b2026\b/i.test(title) && !/\b2027\b/i.test(title)) return true;
  const hasExcludedWindow = excludedGradWindowPatterns.some((pattern) => pattern.test(haystack));
  const hasTargetWindow = targetGradPatterns.some((pattern) => pattern.test(haystack));
  return hasExcludedWindow && !hasTargetWindow;
}

export function roleType(title, text = "") {
  const haystack = `${title}\n${text}`;
  if (internshipPatterns.some((pattern) => pattern.test(title))) return "Internship";
  if (/\b(?:employment\s+type|job\s+type)\b.{0,60}\b(?:intern|internship|co[-\s]?op)\b/i.test(text)) return "Internship";
  if (/\b2027\b/i.test(title)) return "New Grad";
  if (fullTimeNewGradPatterns.some((pattern) => pattern.test(haystack))) return "New Grad";
  return "";
}

export function hasNewGradEligibilityEvidence(title, text = "") {
  const haystack = `${title}\n${text}`;
  if (explicitNewGradPatterns.some((pattern) => pattern.test(haystack))) return true;
  if (targetGradPatterns.some((pattern) => pattern.test(haystack))) return true;
  if (newGrad2027StartPatterns.some((pattern) => pattern.test(haystack))) return true;
  return /\b2027\b/i.test(title);
}

export function isEligibleRole(title, text = "") {
  const trustedText = withoutSyntheticCycleEvidence(text);
  const haystack = `${title}\n${trustedText}`;
  if (hasOnlyExcludedGraduationWindow(title, trustedText)) return false;
  if (isProbablySenior(title)) return false;
  if (hasExcludedDegreeProgram(title)) return false;
  const type = roleType(title, trustedText);
  if (type === "New Grad") return hasNewGradEligibilityEvidence(title, trustedText);
  if (type === "Internship") return internshipEligiblePatterns.some((pattern) => pattern.test(haystack));
  return false;
}

export function chooseResume(title, text = "", fallback = "General CS/SWE") {
  const haystack = `${title}\n${text}`;
  return aiPatterns.some((pattern) => pattern.test(haystack)) ? "AI/ML" : fallback;
}

export function categorize(title, text = "") {
  const haystack = `${title}\n${text}`;
  if (/technical\s+writer|documentation|developer\s+docs|api\s+writer/i.test(haystack)) return "Technical Writing";
  if (/data\s+scientist|data\s+science|applied\s+scientist|analytics|data\s+analyst/i.test(haystack)) return "Data Science";
  if (/aerospace|avionics|propulsion|guidance|navigation|controls|\bGNC\b|flight\s+systems|space\s+systems|mission\s+operations/i.test(haystack)) return "Aerospace Engineering";
  if (/mechanical|manufacturing|hardware|fpga|asic|silicon|electrical|product\s+design/i.test(haystack)) return "Mechanical Engineering";
  if (/machine\s+learning|deep\s+learning|\bAI\b|\bML\b|software|developer|\bSWE\b|backend|frontend|full[-\s]?stack|firmware|network|devops|infrastructure|platform|reliability|\bSRE\b|security|quant|trading|embedded|systems|data\s+engineer|forward\s+deployed\s+engineering|research\s+scientist/i.test(haystack)) return "Software / AI / ML";
  if (/test\s+engineer|robotics/i.test(haystack)) return "Mechanical Engineering";
  return "Other";
}

export function priorityFor(title, sourcePriority) {
  if (/top\s+secret|clearance/i.test(title)) return "P2";
  if (isProbablySenior(title)) return "P2";
  if (targetGradPatterns.some((pattern) => pattern.test(title))) return "P0";
  if (internshipEligiblePatterns.some((pattern) => pattern.test(title))) return "P0";
  if (earlyCareerPatterns.some((pattern) => pattern.test(title))) return "P0";
  if (/new\s+grad|university\s+grad|graduate\s+\w+\s+engineer/i.test(title)) return "P0";
  return sourcePriority ?? "P1";
}

export function isFreshEnough(lead) {
  const title = roleTitle(lead);
  const evidence = [lead.graduation_match, lead.grad_window, lead.season_hint]
    .map(normalize)
    .filter((value) => !/^(?:2027 (?:new grad recruiting|internship) cycle|early career|internship|new grad or university grad)$/i.test(value));
  const context = evidence.join("\n");
  const url = applyUrl(lead);
  const urlIdentity = stableJobIdentity(url);
  if ([...excludedDirectApplyUrls].some((excludedUrl) => canonicalApplyUrl(excludedUrl) === url
    || (urlIdentity && stableJobIdentity(excludedUrl) === urlIdentity))) return false;
  if (!isDirectEmployerApplyUrl(applyUrl(lead))) return false;
  if (/\.\.\.$/.test(title)) return false;
  if (/\.\.\.$/.test(normalize(lead.location))) return false;
  const urlYearEvidence = applyUrl(lead).replace(/[-_/]+/g, " ");
  if (/\b2026\b/i.test(urlYearEvidence) && !/\b2027\b/i.test(urlYearEvidence)) return false;
  if (!isRelevant(title)) return false;
  if (!isEligibleRole(title, context)) return false;
  if (isEligibleRole(title, context)) return true;
  if (!lead.updated_at) return false;
  const updatedAt = Date.parse(lead.updated_at);
  if (Number.isNaN(updatedAt)) return false;
  const ageMs = Date.now() - updatedAt;
  return ageMs <= recentDays * 24 * 60 * 60 * 1000;
}

export function isAllowedLocation(lead) {
  const location = normalize(lead.location);
  if (!location) return false;
  return location.split(/[;\n]+/).some((part) => {
    const segment = normalize(part);
    if (!segment || excludedLocationPatterns.some((pattern) => pattern.test(segment))) return false;
    if (explicitUnitedStatesLocationPatterns.some((pattern) => pattern.test(segment))) return true;
    return namedUnitedStatesStatePattern.test(segment);
  });
}

export function fitNotes(title, category) {
  if (category === "Software / AI / ML") return "Software, AI/ML, infrastructure, systems, or quant-adjacent role.";
  if (category === "Data Science") return "Data science, analytics, applied science, or data engineering role.";
  if (category === "Technical Writing") return "Technical writing, API documentation, or developer docs role.";
  if (category === "Mechanical Engineering") return "Mechanical, hardware, manufacturing, robotics, or test engineering role.";
  if (category === "Aerospace Engineering") return "Aerospace, avionics, propulsion, flight systems, or space systems role.";
  return "Role matches one of the tracked early-career categories.";
}

export function tailoringNotes(title, category, resumeChoice) {
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

export function cleanCompensationText(value) {
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

export function normalizeCompensation(value) {
  return cleanCompensationText(value)
    .replace(/\s*[\u2013\u2014]\s*/g, " - ")
    .replace(/\s+\bto\b\s+/gi, " - ")
    .replace(/\s*\/\s*/g, "/")
    .replace(/\(\s*(USD|CAD|GBP|EUR)\s*\)/gi, "$1")
    .replace(/\$(\d{5,})(?=\D|$)/g, (_, digits) => `$${Number.parseInt(digits, 10).toLocaleString("en-US")}`)
    .replace(/\s*(?:per\s+week|weekly|\/\s*week)\b/gi, "/week")
    .replace(/\s*(?:per\s+month|monthly|\/\s*month)\b/gi, "/month")
    .replace(/\busd\b/gi, "USD")
    .trim();
}

export function findCompensation(patterns, text, rejectHourly = false) {
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

export function compensationFromMoneyFallback(text, isInternship) {
  const haystack = cleanCompensationText(text);
  const markerIndex = haystack.search(/\b(?:salary\s+range|pay\s+range|pay\s+transparency|base\s+salary|compensation|hourly\s+range)\b/i);
  if (markerIndex < 0) return "";
  const window = haystack.slice(markerIndex, markerIndex + 900);
  if (isInternship) {
    const hourlyAmounts = [...window.matchAll(/\$\s?\d{1,3}(?:\.\d{1,2})?(?![\d,])(?:\s*USD)?/gi)].map((match) => normalizeCompensation(match[0]));
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

export function formatMoneyValue(value, currency = "USD") {
  const number = Number.parseFloat(String(value ?? "").replace(/,/g, ""));
  if (Number.isNaN(number)) return "";
  const rounded = Number.isInteger(number) ? number : Number(number.toFixed(2));
  const formatted = rounded.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return currency.toUpperCase() === "USD" ? `$${formatted}` : `${formatted} ${currency.toUpperCase()}`;
}

export function compensationPeriodSuffix(value) {
  const unit = normalize(value).toUpperCase();
  if (/HOUR/.test(unit)) return "/hr";
  if (/DAY/.test(unit)) return "/day";
  if (/WEEK/.test(unit)) return "/week";
  if (/MONTH/.test(unit)) return "/month";
  return "";
}

export function structuredCompensationFromValue(value, seen = new Set()) {
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

export function ensureHourlySuffix(value) {
  const normalized = normalizeCompensation(value);
  if (!normalized || /\b(?:hourly|per hour|an hour)\b|\/(?:hr|hour)\b/i.test(normalized)) return normalized;
  if (!/^\$\s?\d{1,3}(?:\.\d{1,2})?(?:\s*-\s*\$?\s?\d{1,3}(?:\.\d{1,2})?)?(?:\s+USD)?$/i.test(normalized)) return normalized;
  return /\s+USD$/i.test(normalized) ? normalized.replace(/\s+USD$/i, "/hr USD") : `${normalized}/hr`;
}

export function textFromValue(value) {
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

export function extractCompensation(title, ...texts) {
  const text = texts.map((value) => textFromValue(value)).join("\n");
  const haystack = cleanCompensationText(`${title}\n${text}`);
  const isInternship = roleType(title, text) === "Internship";
  const structuredCompensation = texts
    .map((value) => structuredCompensationFromValue(value))
    .find(Boolean) ?? "";
  const hourlyPatterns = [
    /\$\s?\d{1,3}(?:\.\d{1,2})?(?![\d,])\s*(?:-|[\u2013\u2014]|to)\s*\$?\s?\d{1,3}(?:\.\d{1,2})?(?![\d,])\s*(?:USD|\/\s?(?:hr|hour)|per\s+hour|an\s+hour|hourly)?\b/i,
    /\$\s?\d{1,3}(?:\.\d{1,2})?(?![\d,])\s*(?:USD|\/\s?(?:hr|hour)|per\s+hour|an\s+hour|hourly)\b/i,
  ];
  const periodicPatterns = [
    /\$\s?\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?\s*(?:-|[\u2013\u2014]|to)\s*\$?\s?\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?\s*(?:USD\s*)?(?:weekly|per\s+week|\/\s*week|monthly|per\s+month|\/\s*month)\b/i,
    /\$\s?\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?\s*(?:USD\s*)?(?:weekly|per\s+week|\/\s*week|monthly|per\s+month|\/\s*month)\b/i,
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
    const periodic = findCompensation(periodicPatterns, haystack);
    if (periodic) return periodic;
    return ensureHourlySuffix(findCompensation(hourlyPatterns, haystack) || structuredCompensation || compensationFromMoneyFallback(haystack, true));
  }
  return findCompensation(salaryPatterns, haystack, true) || structuredCompensation || compensationFromMoneyFallback(haystack, false);
}
