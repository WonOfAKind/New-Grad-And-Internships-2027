import {
  aiPatterns,
  defaultSearchTexts,
  earlyCareerPatterns,
  excludedDegreeProgramPatterns,
  excludedDirectApplyUrls,
  excludedGradWindowPatterns,
  excludedLocationPatterns,
  explicitUnitedStatesLocationPatterns,
  fullTimeNewGradPatterns,
  internshipEligiblePatterns,
  internshipPatterns,
  namedUnitedStatesStatePattern,
  recentDays,
  seniorPatterns,
  targetGradPatterns,
  titleRolePatterns,
} from "./config.mjs";

export function normalize(value) {
  return String(value ?? "").trim();
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
  if (stableId) return `job|${normalize(company).toLowerCase()}|${stableId}`;
  if (normalizedUrl) return `url|${normalizedUrl}`;
  return `${normalize(company).toLowerCase()}|${normalize(title).replace(/\s+/g, " ").toLowerCase()}|${normalize(location).toLowerCase()}`;
}

export function roleTitle(lead) {
  return lead.role_title ?? lead.title ?? "";
}

export function applyUrl(lead) {
  return canonicalApplyUrl(lead.direct_apply_url ?? lead.url ?? "");
}

export function isRelevant(title) {
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
  if (internshipPatterns.some((pattern) => pattern.test(title)) && internshipEligiblePatterns.some((pattern) => pattern.test(haystack))) return "2027 internship eligible";
  if (/new\s+grad|university\s+grad/i.test(haystack)) return "New grad or university grad";
  if (earlyCareerPatterns.some((pattern) => pattern.test(haystack))) return "Early career";
  if (internshipPatterns.some((pattern) => pattern.test(title))) return "Internship";
  return "";
}

export function hasOnlyExcludedGraduationWindow(title, text = "") {
  const haystack = `${title}\n${text}`;
  const hasExcludedWindow = excludedGradWindowPatterns.some((pattern) => pattern.test(haystack));
  const hasTargetWindow = targetGradPatterns.some((pattern) => pattern.test(haystack));
  return hasExcludedWindow && !hasTargetWindow;
}

export function roleType(title, text = "") {
  const haystack = `${title}\n${text}`;
  if (internshipPatterns.some((pattern) => pattern.test(title))) return "Internship";
  if (/\b(?:employment\s+type|job\s+type)\b.{0,60}\b(?:intern|internship|co[-\s]?op)\b/i.test(text)) return "Internship";
  if (fullTimeNewGradPatterns.some((pattern) => pattern.test(haystack))) return "New Grad";
  return "";
}

export function isEligibleRole(title, text = "") {
  const haystack = `${title}\n${text}`;
  if (hasOnlyExcludedGraduationWindow(title, text)) return false;
  if (isProbablySenior(title)) return false;
  if (hasExcludedDegreeProgram(title)) return false;
  const type = roleType(title, text);
  if (type === "New Grad") return true;
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
  if (/mechanical|manufacturing|hardware|product\s+design|test\s+engineer|robotics/i.test(haystack)) return "Mechanical Engineering";
  if (/machine\s+learning|\bAI\b|\bML\b|software|developer|\bSWE\b|infrastructure|platform|security|quant|trading|embedded|systems|data\s+engineer/i.test(haystack)) return "Software / AI / ML";
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

export function isAllowedLocation(lead) {
  const location = normalize(lead.location);
  if (!location) return false;
  if (explicitUnitedStatesLocationPatterns.some((pattern) => pattern.test(location))) return true;
  if (excludedLocationPatterns.some((pattern) => pattern.test(location))) return false;
  return namedUnitedStatesStatePattern.test(location);
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
