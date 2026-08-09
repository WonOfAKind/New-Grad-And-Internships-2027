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
export const discoveryLimit = envInteger("DISCOVERY_LIMIT", 500, { min: 1, max: 1000 });
export const sitemapDetailLimit = envInteger("SITEMAP_DETAIL_LIMIT", 30, { min: 1, max: 500 });
export const discoveryFeedConcurrency = envInteger("DISCOVERY_FEED_CONCURRENCY", 8, { min: 1, max: 24 });
export const discoveryFeedVerifyLimit = envInteger("DISCOVERY_FEED_VERIFY_LIMIT", 2000, { min: 1, max: 5000 });
export const discoveryFeedTimeoutMs = envInteger("DISCOVERY_FEED_TIMEOUT_MS", 12000, { min: 1000, max: 120000 });
export const discoveryFeedReverifyHours = envInteger("DISCOVERY_FEED_REVERIFY_HOURS", 24, { min: 1, max: 168 });
export const discoveryVerificationVersion = 6;
export const userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36";
export const teslaStateUrl = "https://www.tesla.com/cua-api/apps/careers/state?site=US";
export const supportedAdapters = new Set([
  "amazon",
  "eightfold",
  "greenhouse",
  "lever",
  "ashby",
  "workday",
  "oracle",
  "phenom",
  "avature",
  "tesla",
  "tiktok",
  "html_jobs",
  "google_careers",
  "sitemap_jobs",
  "rss_jobs",
]);
export const defaultSearchTexts = [
  "2027",
  "software engineer",
  "new grad",
  "early career",
  "2027 intern",
  "data science",
  "technical writer",
  "technical communications",
  "mechanical engineer",
  "manufacturing engineer",
  "product development engineer",
  "structural engineer",
  "test and evaluation engineer",
  "quality engineer",
  "materials engineer",
  "weld engineer",
  "flight engineer",
  "engineering development program",
  "aerospace engineer",
  "propulsion engineer",
  "avionics",
  "engineering intern",
  "hardware engineer",
  "product manager",
  "product management intern",
  "quantitative",
];

export const titleRolePatterns = [
  /(?:2027|summer\s+2027|spring\s+2027|fall\s+2027|winter\s+2027).*(?:software|developer|\bSWE\b|machine\s+learning|\bML\b|\bAI\b|data|platform|infrastructure|forward\s+deployed|quant|technical\s+writer|documentation|mechanical|aerospace|aeronautical|avionics|propulsion|manufacturing|systems|product\s+management|product\s+manager)/i,
  /(?:software|developer|\bSWE\b|machine\s+learning|\bML\b|\bAI\b|data|platform|infrastructure|forward\s+deployed|quant|technical\s+writer|documentation|mechanical|aerospace|aeronautical|avionics|propulsion|manufacturing|systems|product\s+management|product\s+manager).*(?:2027|summer\s+2027|spring\s+2027|fall\s+2027|winter\s+2027)/i,
  /new\s+grad(?:uate)?\s+engineer.*software/i,
  /graduate\s+(?:software|mechanical|aerospace|data|systems|manufacturing)\s+engineer/i,
  /software\s+(?:development\s+)?(?:engineer|developer)/i,
  /(?:backend|frontend|full[-\s]?stack|application|factory|flight|security|embedded)\s+software/i,
  /\bSDE\b/i,
  /machine\s+learning\s+engineer/i,
  /\bML\s+engineer/i,
  /\bAI\s+(?:engineer|software engineer)/i,
  /data\s+(?:scientist|analyst|science|analytics)/i,
  /data\s+engineer/i,
  /applied\s+scientist/i,
  /technical\s+(?:writer|writing|communications?|content)|documentation\s+(?:engineer|specialist|writer|developer)|developer\s+(?:documentation|education|content)|api\s+(?:writer|documentation)|information\s+developer|docs?\s+engineer|content\s+(?:developer|designer)\b/i,
  /mechanical\s+(?:design\s+)?engineer|manufacturing\s+engineer|hardware\s+engineer|test\s+(?:and\s+evaluation\s+)?engineer|validation\s+engineer|reliability\s+engineer|product\s+(?:design|development|review)\s+engineer|liaison\s+engineer|equipment\s+engineer|tooling\s+engineer|facilities\s+engineer|applications?\s+engineer|electromechanical|mechatronics|materials?\s+engineer|weld(?:ing)?\s+engineer|metallurg(?:y|ical)|process\s+engineer|quality\s+engineer|thermal\s+engineer|mechanisms?\s+engineer|machine\s+design|vehicle\s+dynamics|powertrain|chassis|hydraulics?|pneumatics?|HVAC|refrigeration|rotating\s+(?:equipment|machinery)|turbomachinery|combustion|acoustics?|vibration|finite\s+element|\bFEA\b|\bCFD\b|computer[-\s]+aided\s+engineering|\bCAE\b/i,
  /aerospace\s+engineer|aeronautical\s+engineer|avionics|propulsion|guidance|navigation|controls|\bGNC\b|flight\s+(?:systems|sciences?|controls|test|dynamics|mechanics|software)|space\s+systems|mission\s+(?:operations|systems|design|integration)|aerodynamics?|aeroelasticity|aerostructures?|airframe|aircraft\s+(?:systems?|design|structures?|integration|certification)|\bstructur(?:al|es?)\s+(?:analysis|design|engineer)|stress\s+(?:analysis|engineer)|loads\s+(?:and\s+dynamics|engineer)|spacecraft|airworthiness|payload\s+engineer|satellite|launch\s+vehicle|air\s+vehicle|astrodynamics|orbital\s+mechanics|aerothermal|mass\s+properties|survivability|rotorcraft|flightworthiness/i,
  /(?:(?:associate|technical)\s+)?product\s+manager|product\s+(?:management|mgmt)|\bAPM\b/i,
  /(?:software|platform|kubernetes|cloud)\s+infrastructure\s+engineer/i,
  /platform\s+(?:software\s+)?engineer/i,
  /site\s+reliability\s+engineer|\bSRE\b/i,
  /forward\s+deployed\s+(?:software\s+)?engineer/i,
  /quant(?:itative)?\s+(?:developer|engineer|researcher|trader|analyst)/i,
  /trading\s+(?:developer|engineer|systems?|platform)/i,
  /career\s+catalyst/i,
  /product\s+engineer/i,
  /(?:robotics|autonomy|simulation)\s+software\s+engineer/i,
  /(?:firmware|embedded|fpga|asic|silicon|network|cloud|devops|reliability|systems?|infrastructure|security|cybersecurity)\s+(?:engineer|developer|intern|internships?)/i,
  /(?:developer|researcher|scientist|writer|trader)\s+(?:intern|internships?|co[-\s]?ops?)/i,
  /(?:engineering|engineer)\s+(?:intern|internships?|co[-\s]?ops?)|(?:intern|internships?|co[-\s]?ops?).*(?:engineering|engineer)/i,
  /engineering\s+(?:rotational|development|graduate|early\s+career)\s+(?:program|track)|engineering\s+corporate\s+(?:internship|intern)\s+program/i,
  /(?:intern|internships?|co[-\s]?ops?).*(?:software|developer|firmware|embedded|machine\s+learning|deep\s+learning|\bAI\b|\bML\b|data\s+(?:science|scientist|engineering|engineer|analytics|analyst)|technical\s+writer|documentation|quant|trading|hardware|fpga|asic|mechanical|aerospace|aeronautical|avionics|product\s+(?:design|management|mgmt)|manufacturing|thermal|propulsion)/i,
  /(?:quantitative|algorithmic)\s+(?:research|researcher|trading|trader|development|developer)/i,
  /(?:machine\s+learning|deep\s+learning|artificial\s+intelligence|computer\s+vision)\s+(?:researcher|research|scientist|engineer|intern)/i,
];

export const internshipPatterns = [
  /\binterns?\b/i,
  /\binternships?\b/i,
  /\bco[-_\s]?ops?(?=\b|_)/i,
  /\bcoops?\b/i,
  /\bapprentice(?:ship)?\b/i,
  /\bstudent\s+(?:intern|researcher)\b/i,
  /\bsummer\s+analyst\b/i,
];

export const earlyCareerPatterns = [
  /\bearly[-\s]+careers?\b/i,
  /\bentry[-\s]?level\b/i,
  /\bcareer\s+catalyst\b/i,
  /\bnew\s+college\s+grad(?:uate)?\b/i,
  /\brecent\s+grad(?:uate)?\b/i,
  /\bjunior\b/i,
  /\bjr\.?\b/i,
  /\bassociate\s+staff\b/i,
  /^assistant\s+(?!(?:chief|manager)\b)(?:[a-z&/-]+\s+){0,6}engineer\b/i,
  /\bcampus\s+(?:hire|recruiting)\b/i,
  /\buniversity\s+(?:hire|recruiting)\b/i,
  /\bengineering\s+(?:development|rotation(?:al)?)\s+program\b/i,
];

export const explicitNewGradPatterns = [
  /\bnew\s+grad(?:uate)?s?\b/i,
  /\buniversity\s+grad(?:uate)?s?\b/i,
  /\bnew\s+college\s+grad(?:uate)?s?\b/i,
  /\bcollege\s+grad(?:uate)?s?\b/i,
  /\bgraduate\s+(?:software|mechanical|aerospace|data|systems?|manufacturing|hardware|firmware|electrical|quantitative|machine\s+learning|product)\s+(?:engineer|developer|researcher|trader|manager)\b/i,
  /\b(?:software|mechanical|aerospace|data|systems?|manufacturing|hardware|firmware|electrical|quantitative|machine\s+learning|product)\s+(?:engineer|developer|researcher|trader|manager)\s+graduate\b/i,
  /\b(?:engineer|developer|researcher|scientist|writer|trader|analyst|designer|product\s+manager)\s+graduate\b/i,
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
  /\b2027\b.{0,140}\b(?:intern|internships?|co[-\s]?ops?|summer\s+analyst)\b/i,
  /\b(?:intern|internships?|co[-\s]?ops?|summer\s+analyst)\b.{0,140}\b2027\b/i,
  /(?:summer|spring|fall|winter)\s+2027\s+(?:intern|internships?|co[-\s]?ops?)/i,
  /(?:intern|internships?|co[-\s]?ops?).*(?:summer|spring|fall|winter)\s+2027/i,
  /(?:summer|spring|fall|winter)\s+2027/i,
  /2027\s+(?:intern|internships?|co[-\s]?ops?)/i,
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
  /\bmid[-\s]+career\b/i,
  /\bmid[-\s]+level\b/i,
  /\bexperienced\b/i,
];

export const excludedDegreeProgramPatterns = [
  /\bph\.?\s*d\.?\b/i,
  /\bdoctorate\b/i,
  /\bdoctoral\b/i,
  /\bmaster'?s\b/i,
  /\bm\.?\s?s\.?\b/i,
  /\bm\.?\s?b\.?\s?a\.?\b/i,
  /\bmaster\s+of\s+business\s+administration\b/i,
];

export const excludedLocationPatterns = [
  /canada|toronto|vancouver|montreal|ottawa/i,
  /\b(?:Alberta|British Columbia|Manitoba|New Brunswick|Newfoundland(?: and Labrador)?|Northwest Territories|Nova Scotia|Nunavut|Ontario|Prince Edward Island|Quebec|Québec|Saskatchewan|Yukon)\b/i,
  /mexico|brazil|argentina|chile|colombia/i,
  /\bindia\b|bengaluru|bangalore/i,
  /singapore/i,
  /sydney|australia/i,
  /seoul|south korea/i,
  /\bisrael\b|\bhaifa\b/i,
  /london|dublin|ireland|united kingdom|uk\b/i,
  /germany|france|japan|poland|romania|netherlands|amsterdam/i,
  /(?:^|,)\s*(?:IE|IRL|GB|GBR|DEU|FRA|IND|SGP|AUS|JPN|KOR)\s*$/i,
  /,\s*[A-Z]{2,3},\s*IN\s*$/,
  /,\s*(?:AB|BC|MB|NB|NL|NS|NT|NU|ON|PE|QC|SK|YT),\s*(?:CA|CAN)\s*$/i,
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
  /\b2027\s+start\b/i,
  /class\s+of\s+2027/i,
  /2027\s+grad(?:uate)?/i,
  /grad(?:uating|uation)?\s+(?:in\s+)?(?:spring|summer|fall|winter)?\s*2027/i,
  /(?:spring|summer|fall|winter)\s+2027\s+grad(?:uate)?/i,
  /(?:may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|dec(?:ember)?)\s+2027/i,
  /2027\s+(?:new\s+grad|university\s+grad|early\s+career)/i,
  /new\s+grad(?:uate)?.*2027/i,
];

export const excludedGradWindowPatterns = [
  /class\s+of\s+202[0-6]/i,
  /202[0-6]\s+grad(?:uate)?/i,
  /grad(?:uating|uation)?\s+(?:in\s+)?(?:spring|summer|fall|winter)?\s*202[0-6]/i,
  /(?:spring|summer|fall|winter)\s+202[0-6]\s+grad(?:uate)?/i,
  /(?:may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|dec(?:ember)?)\s+202[0-6]/i,
  /202[0-6]\s+(?:new\s+grad|university\s+grad|early\s+career)/i,
  /(?:spring|summer|fall|winter)\s+202[0-6]/i,
  /202[0-6]\s+start/i,
  /start(?:ing)?\s+(?:in\s+)?(?:spring|summer|fall|winter)?\s*202[0-6]/i,
  /(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+202[0-6]\s+start/i,
];

export const excludedDirectApplyUrls = new Set([
  "https://boards.greenhouse.io/spacex/jobs/8376990002?gh_jid=8376990002",
  "https://boards.greenhouse.io/spacex/jobs/8446263002?gh_jid=8446263002",
]);
