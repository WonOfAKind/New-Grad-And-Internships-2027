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
  if (/^JPMorgan\s*Chase(?:\s*&\s*Co\.?)?$/i.test(cleaned)) return "JPMorgan Chase";
  if (/^Base Power Company$/i.test(cleaned)) return "Base Power";
  if (/^SEL \(Schweitzer Engineering Laboratories\)$/i.test(cleaned)) return "Schweitzer Engineering Laboratories";
  if (/^Susquehanna$/i.test(cleaned)) return "Susquehanna International Group";
  if (/^Pivotal(?:\s+Software)?$/i.test(cleaned)) return "Pivotal";
  return cleaned;
}

export function normalizeRoleTitle(value) {
  return normalizeDisplayText(value).replace(/[🆕🛂✅🔒✓]+|\p{Regional_Indicator}{2}/gu, "").replace(/\s+/g, " ").trim();
}

export function withoutSyntheticCycleEvidence(value) {
  return normalize(value)
    .replace(/\b2027\s+new\s+grad\s+recruiting\s+cycle\b/gi, " ")
    .replace(/\b2027\s+internship\s+cycle\b/gi, " ")
    // Some employers publish separate salary bands labelled "Recent Graduate
    // Hiring Range" and "Experienced Hiring Range" on every requisition. The
    // salary label is not evidence that the role accepts recent graduates.
    .replace(/\brecent\s+graduate\s+hiring\s+range\b/gi, "hiring range")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function dateOnly(value) {
  const text = normalize(value);
  if (!text) return "";
  const direct = /^(\d{4}-\d{2}-\d{2})$/.exec(text)?.[1];
  if (direct) return direct;
  const isoCalendarDate = /^(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.exec(text)?.[1];
  if (isoCalendarDate) return isoCalendarDate;
  const monthNames = {
    jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
    jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
  };
  const named = /^(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,\s*|\s+)(\d{4})$/i.exec(text);
  if (named) {
    const month = monthNames[named[1].slice(0, 3).toLowerCase()];
    const day = String(Number(named[2])).padStart(2, "0");
    return `${named[3]}-${month}-${day}`;
  }
  const numeric = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(text);
  if (numeric) {
    const month = String(Number(numeric[1])).padStart(2, "0");
    const day = String(Number(numeric[2])).padStart(2, "0");
    return `${numeric[3]}-${month}-${day}`;
  }
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
        const rotatingLoxoToken = /(?:^|\.)loxo\.co$/i.test(parsed.hostname) && key === "t";
        if (/^utm_/i.test(key) || /^(?:gh_src|lever-source|ref|referrer|source|sourceToken)$/i.test(key) || rotatingLoxoToken) {
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
      || /\/([0-9a-f]{20,})\/job\/?$/i.exec(parsed.pathname)?.[1]
      || /_([A-Z]{0,8}\d[\w-]*)(?:\/apply)?\/?$/i.exec(parsed.pathname)?.[1]
      || /(?:^|-)(\d{6,})\/?$/i.exec(parsed.pathname)?.[1];
    let identity = normalize(queryId || pathId).toLowerCase();
    if (/(?:myworkdayjobs|myworkdaysite)\.com$/i.test(parsed.hostname)) {
      identity = identity.replace(/-\d+$/, "");
    }
    return identity;
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

export function isRelevant(title, text = "") {
  const haystack = `${title}\n${text}`;
  if (/\b(?:recruiter|recruiting|talent\s+acquisition|human\s+resources?)\b/i.test(title)) return false;
  if (/\b(?:private\s+equity|investment\s+(?:associate|banking|analyst)|wealth\s+management)\b/i.test(title)) return false;
  if (/\bproduct\s+designer\b/i.test(title) && !/\bengineer(?:ing)?\b/i.test(title)) return false;
  if (/\boperations?\s+(?:intern|internships?|co[-\s]?ops?)\b/i.test(title) && !/engineer|technical/i.test(title)) return false;
  if (/\b(?:campaign|marketing|sales|business\s+development|human\s+resources?)\b/i.test(title)
    && !/\b(?:engineer(?:ing)?|developer|data\s+(?:scientist|engineer)|technical\s+(?:writer|communications?)|quantitative)\b/i.test(title)) return false;
  if (titleRolePatterns.some((pattern) => pattern.test(title))) return true;
  const genericEngineeringTitle = /\b(?:associate\s+)?engineer(?:ing)?\s*(?:i|1)?\b|\b(?:engineer(?:ing)?|technical)\s+(?:intern|internship|co[-\s]?op)\b/i.test(title);
  return genericEngineeringTitle && titleRolePatterns.some((pattern) => pattern.test(haystack));
}

export function isProbablySenior(title) {
  // "Manager" normally signals a senior/people-management role, but Product
  // Manager is the name of an individual-contributor discipline. Preserve
  // other senior markers such as Senior, Lead, Staff, and Principal.
  const withoutProductManager = String(title).replace(
    /\b(?:(?:associate|technical)\s+)?product\s+manager\b/gi,
    "product role",
  );
  // Aerospace and manufacturing employers commonly publish one requisition
  // for several levels. Keep it when an Associate/Entry tier is explicitly
  // offered, while still rejecting a plain Senior or Senior Associate title.
  const withoutAssociateStaff = withoutProductManager.replace(/\bassociate\s+staff\b/gi, "associate tier");
  const withoutEntryInclusiveLevelLists = withoutAssociateStaff.replace(
    /\((?=[^)]*\b(?:associate|entry[-\s]?level|level\s*(?:i|1))\b)(?=[^)]*\b(?:mid[-\s]?level|senior)\b)[^)]*\)/gi,
    "(associate level)",
  );
  return seniorPatterns.some((pattern) => pattern.test(withoutEntryInclusiveLevelLists));
}

export function hasExcludedDegreeProgram(title) {
  const hasBachelorEligibility = /\b(?:bachelor'?s?|undergraduate|undergrad|B\.?\s?S\.?)\b/i.test(title);
  return excludedDegreeProgramPatterns.some((pattern) => pattern.test(title)) && !hasBachelorEligibility;
}

const bachelorDegreeToken = String.raw`(?:bachelor(?:'s|\s+of\s+(?:science|arts|engineering))?(?:\s+degree)?|baccalaureate(?:\s+degree)?|B\.?\s?(?:S|A|E)\.?(?:\s+degree)?)`;
const graduateDegreeToken = String.raw`(?:master(?:'s|\s+of\s+(?:science|arts|engineering|business\s+administration))?(?:\s+degree)?|M\.?\s?(?:S|A|E|B\.?\s?A)\.?(?:\s+degree)?|Ph\.?\s?D\.?(?:\s+degree)?|doctorate|doctoral\s+degree)`;
const experienceNumberToken = String.raw`(?:\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)`;

function qualificationRequirementText(value) {
  const text = normalize(value).replace(/[\u2018\u2019]/g, "'").replace(/\s+/g, " ").trim();
  if (!text) return "";
  const headingPattern = /\b(?:Minimum\s+(?:Qualifications?|Requirements?)|Required\s+(?:Qualifications?|Requirements?)|Basic\s+(?:Qualifications?|Requirements?)|Job\s+Requirements?|Requirements?|Education)\b/g;
  const stops = /\b(?:Preferred\s+(?:Qualifications?|Requirements?|Skills?)|Desired\s+(?:Qualifications?|Requirements?|Skills?)|Recent\s+Graduate\s+Hiring\s+Range|Experienced\s+Hiring\s+Range|Disclaimer)\b/;
  const starts = [...text.matchAll(headingPattern)].map((match) => match.index).filter((index) => index !== undefined);
  if (starts.length === 0) return text;
  return starts.map((start) => {
    const window = text.slice(start, start + 2400);
    const stop = window.search(stops);
    return stop < 0 ? window : window.slice(0, stop);
  }).join(" ");
}

function requiredExperienceYears(value) {
  const yearsByNumber = new Map([
    ["one", 1], ["two", 2], ["three", 3], ["four", 4], ["five", 5],
    ["six", 6], ["seven", 7], ["eight", 8], ["nine", 9], ["ten", 10],
  ]);
  const toYears = (value) => Number(value) || yearsByNumber.get(String(value).toLowerCase()) || 0;
  const beforeExperience = new RegExp(
    `\\b(${experienceNumberToken})(?:\\s*(?:\\+|[-\\u2013\\u2014]\\s*\\d{1,2}\\+?)|\\s+or\\s+more)?\\s+years?(?:['\\u2019])?\\s+(?:of\\s+)?(?:[a-z][a-z/-]*\\s+){0,8}experience\\b`,
    "gi",
  );
  const afterExperience = new RegExp(
    `\\bexperience\\b(?:\\s+(?:with|in|using|developing|working|related|of|as|and|or|\\([^)]{0,80})){0,8}[^.;:]{0,100}?\\(?(${experienceNumberToken})(?:\\s*(?:\\+|[-\\u2013\\u2014]\\s*\\d{1,2}\\+?))?\\s+years?`,
    "gi",
  );
  return [
    ...[...value.matchAll(beforeExperience)].map((match) => toYears(match[1])),
    ...[...value.matchAll(afterExperience)].map((match) => toYears(match[1])),
  ];
}

/**
 * Rejects qualification text whose zero-experience education path requires a
 * graduate degree. A plain bachelor's-or-master's choice remains eligible,
 * while "master's, or bachelor's plus experience" does not qualify a new
 * bachelor's graduate.
 */
export function hasIneligibleBachelorNewGradRequirements(text = "") {
  const requirements = qualificationRequirementText(text);
  if (!requirements) return false;

  const requiredYears = requiredExperienceYears(requirements);
  if (requiredYears.some((years) => years >= 3)) return true;

  const preferencePattern = new RegExp(
    `(?:${graduateDegreeToken})[^.;]{0,100}\\b(?:preferred|desired|a\\s+plus|advantage|not\\s+required)\\b|\\b(?:preferred|desired|preference|a\\s+plus)\\b[^.;]{0,100}(?:${graduateDegreeToken})`,
    "gi",
  );
  const requiredDegreeText = requirements.replace(preferencePattern, " ");
  const graduatePattern = new RegExp(`\\b${graduateDegreeToken}\\b\\.?`, "i");
  if (!graduatePattern.test(requiredDegreeText)) return false;

  const bachelorPattern = new RegExp(`\\b${bachelorDegreeToken}\\b\\.?`, "i");
  if (!bachelorPattern.test(requiredDegreeText)) return true;

  const bachelorExperienceAfter = new RegExp(
    `\\b${bachelorDegreeToken}\\b\\.?[^.;]{0,180}?\\b${experienceNumberToken}(?:\\s*(?:\\+|[-\\u2013\\u2014]\\s*\\d{1,2}\\+?)|\\s+or\\s+more)?\\s+years?`,
    "i",
  );
  const bachelorExperienceBefore = new RegExp(
    `\\b${experienceNumberToken}(?:\\s*(?:\\+|[-\\u2013\\u2014]\\s*\\d{1,2}\\+?)|\\s+or\\s+more)?\\s+years?[^.;]{0,140}?\\b${bachelorDegreeToken}\\b\\.?`,
    "i",
  );
  const bachelorExtensiveExperience = new RegExp(
    `\\b${bachelorDegreeToken}\\b\\.?[^.;]{0,180}?\\b(?:extensive|significant|substantial)\\b[^.;]{0,50}\\bexperience\\b`,
    "i",
  );
  return bachelorExperienceAfter.test(requiredDegreeText)
    || bachelorExperienceBefore.test(requiredDegreeText)
    || bachelorExtensiveExperience.test(requiredDegreeText);
}

export function graduationMatch(title, text = "") {
  const haystack = `${title}\n${text}`;
  if (internshipPatterns.some((pattern) => pattern.test(title)) && internshipEligiblePatterns.some((pattern) => pattern.test(haystack))) return "2027 internship eligible";
  if (targetGradPatterns.some((pattern) => pattern.test(haystack))) return "2027 grad eligible";
  if (newGrad2027StartPatterns.some((pattern) => pattern.test(haystack))) return "Summer 2027 start";
  if (explicitNewGradPatterns.some((pattern) => pattern.test(haystack))) return "Explicit new grad role";
  if (hasVerifiedEntryLevelEvidence(title, text)) return "Verified early career (BS)";
  if (earlyCareerPatterns.some((pattern) => pattern.test(haystack))) return "Early career";
  if (internshipPatterns.some((pattern) => pattern.test(title))) return "Internship";
  return "";
}

export function hasOnlyExcludedGraduationWindow(title, text = "") {
  const haystack = `${title}\n${text}`;
  const titleYears = [...String(title).matchAll(/\b(20\d{2})\b/g)].map((match) => Number(match[1]));
  if (titleYears.some((year) => year < 2027) && !titleYears.includes(2027)) return true;
  const hasExcludedWindow = excludedGradWindowPatterns.some((pattern) => pattern.test(haystack));
  const hasTargetWindow = targetGradPatterns.some((pattern) => pattern.test(haystack))
    || internshipEligiblePatterns.some((pattern) => pattern.test(haystack));
  return hasExcludedWindow && !hasTargetWindow;
}

export function roleType(title, text = "") {
  const haystack = `${title}\n${text}`;
  // Explicit internship wording in the official title is authoritative and
  // must win over new-graduate language in a description or stale cache.
  if (internshipPatterns.some((pattern) => pattern.test(title))) return "Internship";
  if (/\b(?:employment\s+type|job\s+type)\b.{0,60}\b(?:intern|internships?|co[-\s]?ops?)\b/i.test(text)) return "Internship";
  if (/\b2027\b/i.test(title)) return "New Grad";
  if (hasVerifiedEntryLevelEvidence(title, text)) return "New Grad";
  if (fullTimeNewGradPatterns.some((pattern) => pattern.test(haystack))) return "New Grad";
  return "";
}

export function hasNewGradEligibilityEvidence(title, text = "") {
  const haystack = `${title}\n${text}`;
  if (explicitNewGradPatterns.some((pattern) => pattern.test(haystack))) return true;
  if (targetGradPatterns.some((pattern) => pattern.test(haystack))) return true;
  if (newGrad2027StartPatterns.some((pattern) => pattern.test(haystack))) return true;
  if (earlyCareerPatterns.some((pattern) => pattern.test(title))) return true;
  if (/(?:^|\n)\s*(?:early[-\s]+career|entry[-\s]?level)\s*(?:\n|$)/i.test(text)) return true;
  if (/\b(?:experience|career)\s+(?:level|stage)\b.{0,40}\b(?:early[-\s]+career|entry[-\s]?level)\b/i.test(text)) return true;
  if (/\brecent\s+graduate\s+hiring\s+range\b/i.test(text)) return true;
  if (hasVerifiedEntryLevelEvidence(title, text)) return true;
  return /\b2027\b/i.test(title);
}

export function hasVerifiedEntryLevelEvidence(title, text = "") {
  const levelOneTitle = /\b(?:engineer|developer|scientist|analyst|writer|researcher|designer|trader|manager)\s+(?:(?:level\s*)?(?:i|1)|associate)\b|\b(?:engineer|developer|scientist|analyst|designer)\s*[-(]\s*associate(?:\s+level)?\b|\bSDE\s*(?:i|1)\b|\bassociate\s+(?:[a-z&/-]+\s+){0,5}(?:engineer|developer|scientist|analyst|designer)\b/i.test(title);
  if (!levelOneTitle) return false;
  const titleIsExplicitlyJunior = /\bassociate\b|\bjunior\b|\b(?:engineer|developer|scientist|analyst|writer|researcher|designer|trader|manager)\s+(?:(?:level\s*)?(?:i|1))\b|\bSDE\s*(?:i|1)\b/i.test(title);
  if (!titleIsExplicitlyJunior && !earlyCareerPatterns.some((pattern) => pattern.test(text))) return false;
  if (!/\b(?:bachelor'?s?|undergraduate|undergrad|B\.?\s?S\.?)\b/i.test(text)) return false;
  const requiredText = normalize(text).split(/\bpreferred\s+qualifications?\b/i)[0];
  const requiredYears = [...requiredText.matchAll(/\b(\d{1,2})(?:\s*\+|\s+or\s+more)?\s+years?\s+(?:of\s+)?(?:[a-z][a-z/-]*\s+){0,8}experience\b/gi)]
    .map((match) => Number(match[1]));
  return !requiredYears.some((years) => years >= 3);
}

export function isEligibleRole(title, text = "") {
  const trustedText = withoutSyntheticCycleEvidence(text);
  const haystack = `${title}\n${trustedText}`;
  if (hasOnlyExcludedGraduationWindow(title, trustedText)) return false;
  if (isProbablySenior(title)) return false;
  if (hasExcludedDegreeProgram(title)) return false;
  const type = roleType(title, trustedText);
  if (type === "New Grad") {
    if (hasIneligibleBachelorNewGradRequirements(trustedText)) return false;
    return hasNewGradEligibilityEvidence(title, trustedText);
  }
  if (type === "Internship") return internshipEligiblePatterns.some((pattern) => pattern.test(haystack));
  return false;
}

export function chooseResume(title, text = "", fallback = "General CS/SWE") {
  const haystack = `${title}\n${text}`;
  return aiPatterns.some((pattern) => pattern.test(haystack)) ? "AI/ML" : fallback;
}

export const boardDisciplines = [
  { slug: "software", name: "Software Engineering" },
  { slug: "ai-ml", name: "AI / Machine Learning" },
  { slug: "data", name: "Data Science & Analytics" },
  { slug: "product-management", name: "Product Management" },
  { slug: "hardware-electrical", name: "Hardware & Electrical Engineering" },
  { slug: "mechanical", name: "Mechanical Engineering" },
  { slug: "aerospace", name: "Aerospace Engineering" },
  { slug: "manufacturing-industrial", name: "Manufacturing & Industrial Engineering" },
  { slug: "technical-writing", name: "Technical Writing" },
  { slug: "other-engineering", name: "Other Engineering" },
];

export function disciplineName(slug) {
  return boardDisciplines.find((discipline) => discipline.slug === slug)?.name ?? "Other Engineering";
}

export function categorizeDisciplines(title, text = "", { companyDisciplines = [] } = {}) {
  const haystack = `${title}\n${text}`;
  const matches = [];
  const digitalTitle = /software|developer|data|cyber|network|cloud|infrastructure|firmware|electrical|electronics|hardware|embedded|machine\s+learning|artificial\s+intelligence|algorithms?|signal\s+processing|semiconductor|photonics?|optical|optoelectronic|power\s+systems?|\bAI\b|\bML\b|\bDSP\b|\bFPGA\b|\bASIC\b|radio[-\s]?frequency|\bRF\b/i.test(title);
  const add = (slug, pattern, value = title) => {
    if (pattern.test(value) && !matches.includes(slug)) matches.push(slug);
  };
  add("product-management", /(?:(?:associate|technical)\s+)?product\s+manager|product\s+(?:management|mgmt)|\bAPM\b/i);
  add("technical-writing", /technical\s+(?:writer|writing|communications?|content)|documentation\s+(?:engineer|specialist|writer|developer)|developer\s+(?:docs|documentation|education|content)|api\s+(?:writer|documentation)|information\s+developer|docs?\s+engineer/i);
  add("data", /data\s+(?:scientist|science|analytics|analyst)|(?:applied|research)\s+scientist|\bdata\s*&\s*AI\b|statistical\s+modeling/i);
  add("ai-ml", /machine\s+learning|deep\s+learning|artificial\s+intelligence|\bAI\b|\bML\b|computer\s+vision|applied\s+scientist|research\s+scientist/i);
  add("aerospace", /aerospace|aeronautical|avionics|propulsion|guidance|navigation|\bGNC\b|flight\s+(?:systems|safety|sciences?|controls|test|dynamics|mechanics|software|engineering)|space\s+systems|mission\s+(?:operations|systems|design|integration)|aerodynamics?|aeroelasticity|aerostructures?|airframe|airborne\s+(?:systems?|radar|platform)|radar\s+(?:systems?|engineering)|aircraft\s+(?:systems?|design|structures?|integration|certification)|spacecraft|airworthiness|safety\s+and\s+airworthiness|product\s+support\s+engineer|payload\s+engineer|satellite|launch\s+vehicle|air\s+vehicle|astrodynamics|orbital\s+mechanics|aerothermal|mass\s+properties|survivability|rotorcraft|flightworthiness/i);
  add("mechanical", /mechanical|electromechanical|mechatronics|thermal|fluid\s+(?:systems|dynamics)|heat\s+transfer|product\s+(?:design|development|review)\s+engineer|engineering[^\n]{0,100}(?:product\s+development|materials|weld(?:ing)?)|liaison\s+engineer|equipment\s+engineer|tooling\s+engineer|materials?\s+engineer|\bweld(?:ing)?\b|metallurg(?:y|ical)|mechanisms?\s+engineer|machine\s+design|vehicle\s+dynamics|powertrain|chassis|hydraulics?|pneumatics?|HVAC|refrigeration|rotating\s+(?:equipment|machinery)|turbomachinery|combustion|acoustics?|vibration|finite\s+element|\bFEA\b|\bCFD\b|computer[-\s]+aided\s+engineer(?:ing)?|\bCAE\b|aerostructures?/i);
  add("hardware-electrical", /hardware|electrical|electronics|firmware|embedded|\b(?:fpga|asic|dsp|rf)\b|radio[-\s]?frequency|signal\s+processing|silicon|semiconductor|photonics?|optical|optoelectronic|power\s+systems?|circuit|\bPCB\b|avionics|computer\s+engineering/i);
  add("manufacturing-industrial", /manufactur|industrial\s+engineer|production\s+engineer|process\s+(?:development\s+)?engineer|quality\s+engineer|supplier\s+quality|sustaining\s+engineer|facilities\s+engineer|operations\s+engineer|automation\s+engineer|controls\s+engineer|tooling\s+engineer|\bweld(?:ing)?\b|metallurg(?:y|ical)|engineering[^\n]{0,100}materials|materials?\s+(?:and|&)\s+process|\bNPI\b|continuous\s+improvement/i);
  add("software", /software|developer|\bSWE\b|backend|frontend|full[-\s]?stack|network|devops|infrastructure|platform|reliability|\bSRE\b|security|cyber|quant|trad(?:er|ing)|data\s+engineer|forward\s+deployed|cloud\s+engineer|database\s+engineer/i);
  const explicitManufacturingTitle = /manufactur|industrial\s+engineer|production\s+engineer|process\s+(?:development\s+)?engineer|supplier\s+quality|tooling\s+engineer|\bweld(?:ing)?\b|metallurg|materials?\s+(?:and|&)\s+process|\bNPI\b/i.test(title);
  if (digitalTitle && !explicitManufacturingTitle && matches.includes("manufacturing-industrial")) {
    matches.splice(matches.indexOf("manufacturing-industrial"), 1);
  }
  const structuralTitle = /\bstructur(?:al|es?)\s+(?:analysis|design|engineer)|loads\s+(?:and\s+dynamics|engineer)|stress\s+(?:analysis|engineer)|material\s+review/i.test(title);
  const civilInfrastructureTitle = /\bcivil|transmission|distribution|substation|buildings?|bridge|roadway|highway|water|wastewater|\brail\b|track\s+design|\bpower\b|solar/i.test(title);
  const explicitMechanicalTitle = /\bmechanical\b|electromechanical|mechatronics|thermal|heat\s+transfer|product\s+(?:design|development|review)|liaison|equipment|tooling|materials?|weld|metallurg|mechanisms?|machine\s+design|vehicle\s+dynamics|powertrain|chassis|HVAC|turbomachinery|combustion|finite\s+element|\bFEA\b|\bCFD\b|computer[-\s]+aided\s+engineer|\bCAE\b/i.test(title);
  if (civilInfrastructureTitle && !explicitMechanicalTitle && matches.includes("mechanical")) {
    matches.splice(matches.indexOf("mechanical"), 1);
  }
  const explicitAviationTitle = /aerospace|aeronautical|aviation|aircraft|airframe|aerostructure|flight|spacecraft|launch\s+vehicle/i.test(title);
  if (!digitalTitle
    && structuralTitle
    && companyDisciplines.includes("aerospace")
    && (!civilInfrastructureTitle || explicitAviationTitle)) {
    if (!matches.includes("aerospace")) matches.push("aerospace");
    if (companyDisciplines.includes("mechanical") && !matches.includes("mechanical")) matches.push("mechanical");
  }
  if (!digitalTitle
    && companyDisciplines.includes("aerospace")
    && /\b(?:systems?|integration|test|verification|validation|reliability|safety|design|development|mission|project)\s+engineer\b|\bsystems?\s+engineering\s+(?:intern|co[-\s]?op)\b|\bengineer(?:ing)?\s+(?:associate|i|1)\b/i.test(title)
    && !matches.includes("aerospace")) {
    matches.push("aerospace");
  }
  if (!digitalTitle
    && companyDisciplines.includes("mechanical")
    && /\b(?:design|test|validation|reliability|materials?|equipment|tooling|applications?|product\s+development|research\s+and\s+development|R&D)\s+engineer\b/i.test(title)
    && !matches.includes("mechanical")) {
    matches.push("mechanical");
  }
  if (matches.length === 0) {
    if (!civilInfrastructureTitle) {
      add("aerospace", /aerospace|aeronautical|avionics|propulsion|\bGNC\b|flight\s+(?:systems|sciences?)|spacecraft|aerodynamics?|space\s+systems/i, haystack);
      add("mechanical", /mechanical\s+engineering|electromechanical|mechatronics|thermal\s+engineering|materials\s+engineering|product\s+design/i, haystack);
    }
    add("hardware-electrical", /electrical\s+engineering|hardware\s+engineering|embedded\s+systems|semiconductor/i, haystack);
    add("manufacturing-industrial", /manufacturing\s+engineering|industrial\s+engineering|production\s+engineering|process\s+engineering/i, haystack);
    add("data", /data\s+(?:scientist|science|analytics)|statistical\s+modeling/i, haystack);
    add("ai-ml", /machine\s+learning|deep\s+learning|artificial\s+intelligence|\bAI\b|\bML\b/i, haystack);
    add("software", /software\s+engineering|backend|frontend|distributed\s+systems|cloud\s+infrastructure/i, haystack);
  }
  return matches.length > 0 ? matches : ["other-engineering"];
}

export function categorize(title, text = "") {
  return disciplineName(categorizeDisciplines(title, text)[0]);
}

export function specialtiesFor(title) {
  const specialties = [];
  const add = (name, pattern) => { if (pattern.test(title)) specialties.push(name); };
  add("propulsion", /propulsion|combustion|turbomachinery/i);
  add("flight-controls-gnc", /guidance|navigation|\bGNC\b|flight\s+controls/i);
  add("structures-stress", /structural|structures|stress|loads|fatigue/i);
  add("thermal-fluids", /thermal|fluids?|heat\s+transfer|aerodynamics?/i);
  add("manufacturing", /manufactur|production|industrialization/i);
  add("test-validation", /test|validation|verification|quality|reliability/i);
  add("hardware-electronics", /hardware|electrical|electronics|\bPCB\b|fpga|asic|silicon|avionics/i);
  add("product", /product\s+(?:manager|management|mgmt|design|development)/i);
  return [...new Set(specialties)];
}

export function priorityFor(title, sourcePriority) {
  if (isProbablySenior(title)) return "P2";
  if (targetGradPatterns.some((pattern) => pattern.test(title))) return "P0";
  if (internshipEligiblePatterns.some((pattern) => pattern.test(title))) return "P0";
  if (earlyCareerPatterns.some((pattern) => pattern.test(title))) return "P0";
  if (/new\s+grad|university\s+grad|graduate\s+\w+\s+engineer/i.test(title)) return "P0";
  return sourcePriority ?? "P1";
}

export function isFreshEnough(lead) {
  const title = roleTitle(lead);
  const evidence = [lead.description, lead.graduation_match, lead.grad_window, lead.season_hint]
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
  const urlYears = [...urlYearEvidence.matchAll(/\b(20\d{2})\b/g)].map((match) => Number(match[1]));
  if (urlYears.some((year) => year < 2027) && !urlYears.includes(2027)) return false;
  if (!isRelevant(title, context)) return false;
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
  if (category === "Software Engineering") return "Software, infrastructure, systems, security, or quant-adjacent role.";
  if (category === "AI / Machine Learning") return "Machine learning, applied AI, computer vision, or research engineering role.";
  if (category === "Data Science & Analytics") return "Data science, analytics, applied science, or statistical modeling role.";
  if (category === "Product Management") return "Product management or associate product management role.";
  if (category === "Technical Writing") return "Technical writing, API documentation, or developer docs role.";
  if (category === "Hardware & Electrical Engineering") return "Hardware, electrical, embedded, firmware, or semiconductor engineering role.";
  if (category === "Mechanical Engineering") return "Mechanical design, thermal, structures, materials, or test engineering role.";
  if (category === "Aerospace Engineering") return "Aerospace, avionics, propulsion, flight systems, or space systems role.";
  if (category === "Manufacturing & Industrial Engineering") return "Manufacturing, industrial, process, production, or quality engineering role.";
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
  const currencyNumberRange = haystack.match(/\b(\d{2,3}(?:,\d{3})+(?:\.\d{1,2})?)\s*(?:-|[\u2013\u2014]|to)\s*(\d{2,3}(?:,\d{3})+(?:\.\d{1,2})?)\s*(USD|CAD|GBP|EUR)\s*(?:annually|per\s+year|yearly)\b/i);
  if (isInternship) {
    const periodic = findCompensation(periodicPatterns, haystack);
    if (periodic) return periodic;
    return ensureHourlySuffix(findCompensation(hourlyPatterns, haystack) || structuredCompensation || compensationFromMoneyFallback(haystack, true));
  }
  if (currencyNumberRange) {
    const min = formatMoneyValue(currencyNumberRange[1], currencyNumberRange[3]);
    const max = formatMoneyValue(currencyNumberRange[2], currencyNumberRange[3]);
    if (min && max) return `${min} - ${max}`;
  }
  return findCompensation(salaryPatterns, haystack, true) || structuredCompensation || compensationFromMoneyFallback(haystack, false);
}
