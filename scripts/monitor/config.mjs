export function envInteger(name, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}; received ${JSON.stringify(raw)}`);
  }
  return value;
}

export const recentDays = envInteger("RECENT_DAYS", 7, { min: 1, max: 365 });
export const maxNewPerCompany = envInteger("MAX_NEW_PER_COMPANY", 20, { min: 1, max: 500 });
export const startedAt = Date.now();
export const fetchTimeoutMs = envInteger("FETCH_TIMEOUT_MS", 7000, { min: 1000, max: 120000 });
export const fetchRetries = envInteger("FETCH_RETRIES", 0, { min: 0, max: 5 });
export const fetchRetryBaseMs = envInteger("FETCH_RETRY_BASE_MS", 350, { min: 0, max: 30000 });
export const atsSourceConcurrency = envInteger("ATS_SOURCE_CONCURRENCY", 12, { min: 1, max: 64 });
export const sourceScanDeadlineMs = envInteger("SOURCE_SCAN_DEADLINE_MS", 90000, { min: 10000, max: 300000 });
export const htmlDetailConcurrency = envInteger("HTML_DETAIL_CONCURRENCY", 4, { min: 1, max: 16 });
export const doubleCheckErrors = process.env.DOUBLE_CHECK_ERRORS !== "0";
export const doubleCheckTimeoutMs = envInteger("DOUBLE_CHECK_TIMEOUT_MS", 15000, { min: 1000, max: 180000 });
export const staleAfterDays = envInteger("STALE_AFTER_DAYS", 21, { min: 1, max: 365 });
export const closureCheckConcurrency = envInteger("CLOSURE_CHECK_CONCURRENCY", 6, { min: 1, max: 24 });
export const closureCheckTimeoutMs = envInteger("CLOSURE_CHECK_TIMEOUT_MS", 8000, { min: 1000, max: 60000 });
export const minAtsSuccessPercent = envInteger("MIN_ATS_SUCCESS_PERCENT", 75, { min: 0, max: 100 });
export const discoveryRefreshHours = envInteger("DISCOVERY_REFRESH_HOURS", 168, { min: 1, max: 720 });
export const discoveryErrorRefreshHours = envInteger("DISCOVERY_ERROR_REFRESH_HOURS", 6, { min: 1, max: 168 });
export const discoveryConcurrency = envInteger("DISCOVERY_CONCURRENCY", 8, { min: 1, max: 32 });
export const discoveryLimit = envInteger("DISCOVERY_LIMIT", 30, { min: 1, max: 1000 });
export const sitemapDetailLimit = envInteger("SITEMAP_DETAIL_LIMIT", 30, { min: 1, max: 500 });
export const discoveryFeedConcurrency = envInteger("DISCOVERY_FEED_CONCURRENCY", 8, { min: 1, max: 24 });
export const discoveryFeedVerifyLimit = envInteger("DISCOVERY_FEED_VERIFY_LIMIT", 600, { min: 1, max: 1000 });
export const discoveryFeedTimeoutMs = envInteger("DISCOVERY_FEED_TIMEOUT_MS", 12000, { min: 1000, max: 120000 });
export const discoveryFeedReverifyHours = envInteger("DISCOVERY_FEED_REVERIFY_HOURS", 24, { min: 1, max: 168 });
export const discoveryVerificationVersion = 5;
export const userAgent = "Mozilla/5.0 (compatible; Codex new-grad role monitor)";
export const teslaStateUrl = "https://www.tesla.com/cua-api/apps/careers/state?site=US";
export const supportedAdapters = new Set([
  "greenhouse",
  "lever",
  "ashby",
  "workday",
  "phenom",
  "avature",
  "tesla",
  "html_jobs",
  "google_careers",
  "sitemap_jobs",
]);
export const defaultSearchTexts = [
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

export const titleRolePatterns = [
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
  /(?:firmware|embedded|fpga|asic|silicon|network|cloud|devops|reliability|systems?|infrastructure|security|cybersecurity)\s+(?:engineer|developer|intern|internship)/i,
  /(?:developer|researcher|scientist|writer|trader)\s+(?:intern|internship|co[-\s]?op)/i,
  /(?:intern|internship|co[-\s]?op).*(?:software|developer|firmware|embedded|machine\s+learning|deep\s+learning|\bAI\b|\bML\b|data\s+(?:science|scientist|engineering|engineer|analytics|analyst)|technical\s+writer|documentation|quant|trading|hardware|fpga|asic|mechanical|aerospace|avionics|product\s+design)/i,
  /(?:quantitative|algorithmic)\s+(?:research|researcher|trading|trader|development|developer)/i,
  /(?:machine\s+learning|deep\s+learning|artificial\s+intelligence|computer\s+vision)\s+(?:researcher|research|scientist|engineer|intern)/i,
];

export const internshipPatterns = [
  /\binterns?\b/i,
  /\binternship\b/i,
  /\bco[-\s]?op\b/i,
  /\bcoop\b/i,
  /\bapprentice(?:ship)?\b/i,
  /\bstudent\s+(?:intern|researcher)\b/i,
];

export const earlyCareerPatterns = [
  /\bearly\s+careers?\b/i,
  /\bentry[-\s]?level\b/i,
  /\bcareer\s+catalyst\b/i,
  /\bnew\s+college\s+grad(?:uate)?\b/i,
  /\brecent\s+grad(?:uate)?\b/i,
];

export const explicitNewGradPatterns = [
  /\bnew\s+grad(?:uate)?s?\b/i,
  /\buniversity\s+grad(?:uate)?s?\b/i,
  /\bnew\s+college\s+grad(?:uate)?s?\b/i,
  /\bcollege\s+grad(?:uate)?s?\b/i,
  /\bgraduate\s+(?:software|mechanical|aerospace|data|systems?|manufacturing|hardware|firmware|electrical|quantitative|machine\s+learning)\s+(?:engineer|developer|researcher|trader)\b/i,
  /\b(?:software|mechanical|aerospace|data|systems?|manufacturing|hardware|firmware|electrical|quantitative|machine\s+learning)\s+(?:engineer|developer|researcher|trader)\s+graduate\b/i,
  /\b2027\s+grads?\b/i,
];

export const newGrad2027StartPatterns = [
  /\b(?:start|starts|starting|begin|begins|beginning|commence|commences|commencing|available\s+to\s+start)\b.{0,50}\b(?:summer\s+2027|may|june|july|august)\s+2027\b/i,
  /\b(?:summer\s+2027|may|june|july|august)\s+2027\b.{0,30}\b(?:start|starts|starting|cohort|program)\b/i,
];

export const fullTimeNewGradPatterns = [
  ...explicitNewGradPatterns,
  /class\s+of\s+2027/i,
  /2027\s+grad(?:uate)?/i,
  /grad(?:uating|uation)?\s+(?:in\s+)?(?:spring|summer|fall|winter)?\s*2027/i,
  /(?:spring|summer|fall|winter)\s+2027\s+grad(?:uate)?/i,
  /(?:may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|dec(?:ember)?)\s+2027/i,
  /2027\s+(?:new\s+grad|university\s+grad|early\s+career)/i,
  ...earlyCareerPatterns,
];

export const internshipEligiblePatterns = [
  /(?:summer|spring|fall|winter)\s+2027\s+(?:intern|internship|co[-\s]?op)/i,
  /(?:intern|internship|co[-\s]?op).*(?:summer|spring|fall|winter)\s+2027/i,
  /(?:summer|spring|fall|winter)\s+2027/i,
  /2027\s+(?:intern|internship|co[-\s]?op)/i,
  /class\s+of\s+2028/i,
  /grad(?:uating|uation)?\s+(?:in\s+)?(?:fall|winter)?\s*2027/i,
  /grad(?:uating|uation)?\s+(?:in\s+)?(?:spring|summer)?\s*2028/i,
];

export const seniorPatterns = [
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

export const excludedDegreeProgramPatterns = [
  /\bph\.?\s*d\.?\b/i,
  /\bdoctorate\b/i,
  /\bdoctoral\b/i,
  /\b(?:bs|b\.s\.)\s*\/\s*(?:ms|m\.s\.)\b/i,
  /\b(?:ms|m\.s\.)\s*\/\s*(?:ph\.?\s*d\.?|phd)\b/i,
  /\((?=[^)]*\b(?:ms|m\.s\.|master'?s)\b)[^)]*\)/i,
  /\bmaster'?s\b/i,
  /\bm\.?\s?s\.?\b/i,
];

export const excludedLocationPatterns = [
  /canada|toronto|vancouver|montreal|ottawa/i,
  /\b(?:Alberta|British Columbia|Manitoba|New Brunswick|Newfoundland(?: and Labrador)?|Northwest Territories|Nova Scotia|Nunavut|Ontario|Prince Edward Island|Quebec|Québec|Saskatchewan|Yukon)\b/i,
  /mexico|brazil|argentina|chile|colombia/i,
  /india|bengaluru|bangalore/i,
  /singapore/i,
  /sydney|australia/i,
  /seoul|south korea/i,
  /london|dublin|ireland|united kingdom|uk\b/i,
  /germany|france|japan|poland|romania|netherlands|amsterdam/i,
];

export const explicitUnitedStatesLocationPatterns = [
  /\b(?:United States(?: of America)?|US|USA|U\.S\.A\.?|U\.S\.)\b/i,
  /\b(?:Remote|Virtual|Hybrid)\s*[-,(]?\s*(?:US|USA|United States)\b/i,
  /\bWashington,?\s+D\.?C\.?\b/i,
  /(?:^|[,;/]\s*)(?:AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC)(?:\b|$)/,
];
export const namedUnitedStatesStatePattern = /\b(?:Alabama|Alaska|Arizona|Arkansas|California|Colorado|Connecticut|Delaware|Florida|Georgia|Hawaii|Idaho|Illinois|Indiana|Iowa|Kansas|Kentucky|Louisiana|Maine|Maryland|Massachusetts|Michigan|Minnesota|Mississippi|Missouri|Montana|Nebraska|Nevada|New Hampshire|New Jersey|New Mexico|New York|North Carolina|North Dakota|Ohio|Oklahoma|Oregon|Pennsylvania|Rhode Island|South Carolina|South Dakota|Tennessee|Texas|Utah|Vermont|Virginia|Washington|West Virginia|Wisconsin|Wyoming)\b/i;

export const aiPatterns = [/machine\s+learning/i, /\bAI\b/i, /\bML\b/i, /data/i, /model/i, /platform/i];
export const targetGradPatterns = [
  /class\s+of\s+2027/i,
  /2027\s+grad(?:uate)?/i,
  /grad(?:uating|uation)?\s+(?:in\s+)?(?:spring|summer|fall|winter)?\s*2027/i,
  /(?:spring|summer|fall|winter)\s+2027\s+grad(?:uate)?/i,
  /(?:may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|dec(?:ember)?)\s+2027/i,
  /2027\s+(?:new\s+grad|university\s+grad|early\s+career)/i,
  /new\s+grad(?:uate)?.*2027/i,
];

export const excludedGradWindowPatterns = [
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

export const excludedDirectApplyUrls = new Set([
  "https://boards.greenhouse.io/spacex/jobs/8376990002?gh_jid=8376990002",
  "https://boards.greenhouse.io/spacex/jobs/8446263002?gh_jid=8446263002",
]);
