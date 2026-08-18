import {
  isExpiredDate,
  normalize,
  normalizeRoleTitle,
  stableJobIdentity,
} from "./domain.mjs";

const closedPagePatterns = [
  /\b(?:job|position|posting|opportunity)\s+(?:is|has been)\s+(?:no longer available|closed|filled|expired)\b/i,
  /\bno longer accepting applications\b/i,
  /\bthe (?:job|position|posting) (?:you(?:'re| are) looking for )?(?:has expired|is unavailable|was removed)\b/i,
  /\bthis (?:job|position|posting) (?:has been closed|is no longer available)\b/i,
  /\bjob not found\b/i,
];

const soft404UrlPatterns = [
  /\/(?:404|not[-_]?found)(?:[./?#]|$)/i,
  /\/errorpages?\/404(?:[./?#]|$)/i,
  /[?&](?:error=(?:true|404)|rr_message=job_not_found)(?:&|$)/i,
];

const ignoredTitleTokens = new Set([
  "a", "an", "and", "at", "career", "careers", "early", "for", "grad", "graduate",
  "intern", "internship", "job", "jobs", "new", "of", "position", "the", "with",
]);

export function closedPageReason(status, html, comparedAt = new Date().toISOString()) {
  if (status === 404 || status === 410) return `HTTP ${status}`;
  if (status < 200 || status >= 300) return "";
  const text = normalize(html);
  if (closedPagePatterns.some((pattern) => pattern.test(text))) return "explicit closed-page message";
  for (const match of text.matchAll(/"validThrough"\s*:\s*"([^"]+)"/gi)) {
    if (isExpiredDate(match[1], comparedAt)) return `expired on ${match[1]}`;
  }
  return "";
}

function collectJobPostings(value, postings = []) {
  if (!value || typeof value !== "object") return postings;
  const type = Array.isArray(value["@type"]) ? value["@type"].join(" ") : normalize(value["@type"]);
  if (/\bJobPosting\b/i.test(type) && normalize(value.title)) postings.push(value);
  if (Array.isArray(value)) {
    for (const item of value) collectJobPostings(item, postings);
  } else {
    for (const item of Object.values(value)) collectJobPostings(item, postings);
  }
  return postings;
}

function structuredValueText(value) {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(structuredValueText).filter(Boolean).join(" ");
  if (!value || typeof value !== "object") return "";
  return Object.entries(value)
    .filter(([key]) => !key.startsWith("@"))
    .map(([, item]) => structuredValueText(item))
    .filter(Boolean)
    .join(" ");
}

function jobPostingsFromHtml(html) {
  const postings = [];
  for (const match of String(html ?? "").matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      collectJobPostings(JSON.parse(match[1].trim()), postings);
    } catch {
      // Ignore malformed or unrelated structured-data snippets.
    }
  }
  return postings;
}

export function matchingJobPostingEvidence(html, expectedTitle) {
  const postings = jobPostingsFromHtml(html);
  const posting = postings.find((item) => titlesLikelySame(expectedTitle, normalizeRoleTitle(item.title)))
    ?? (postings.length === 1 ? postings[0] : null);
  if (!posting) return null;
  const fields = [
    posting.description,
    posting.qualifications,
    posting.experienceRequirements,
    posting.educationRequirements,
    posting.skills,
    posting.responsibilities,
  ];
  return {
    title: normalizeRoleTitle(posting.title),
    context: fields.map(structuredValueText).filter(Boolean).join("\n"),
  };
}

function metaContent(html, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const after = new RegExp(`<meta\\s+[^>]*(?:name|property)=["']${escaped}["'][^>]*content=["']([^"']*)["']`, "i");
  const before = new RegExp(`<meta\\s+[^>]*content=["']([^"']*)["'][^>]*(?:name|property)=["']${escaped}["']`, "i");
  return normalizeRoleTitle(after.exec(html)?.[1] ?? before.exec(html)?.[1] ?? "");
}

export function pageTitleCandidates(html) {
  const titles = jobPostingsFromHtml(html).map((posting) => normalizeRoleTitle(posting.title));
  titles.push(
    metaContent(html, "og:title"),
    metaContent(html, "twitter:title"),
    normalizeRoleTitle(/<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1]?.replace(/<[^>]+>/g, " ") ?? ""),
    normalizeRoleTitle(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.replace(/<[^>]+>/g, " ") ?? ""),
  );
  return [...new Set(titles.filter(Boolean))];
}

function titleTokens(value) {
  return new Set(normalizeRoleTitle(value)
    .toLowerCase()
    .replace(/[^a-z0-9+#.]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 1 && !ignoredTitleTokens.has(token)));
}

export function titlesLikelySame(expected, actual) {
  const expectedTokens = titleTokens(expected);
  const actualTokens = titleTokens(actual);
  if (expectedTokens.size === 0 || actualTokens.size === 0) return false;
  const overlap = [...expectedTokens].filter((token) => actualTokens.has(token)).length;
  return overlap >= Math.min(2, expectedTokens.size, actualTokens.size)
    && overlap / Math.min(expectedTokens.size, actualTokens.size) >= 0.65;
}

export function officialPageRejection(requestedUrl, resolvedUrl, html, expectedTitle, comparedAt = new Date().toISOString()) {
  const closed = closedPageReason(200, html, comparedAt);
  if (closed) return closed;
  if (soft404UrlPatterns.some((pattern) => pattern.test(resolvedUrl))) return "redirected to an error page";

  const expectedId = stableJobIdentity(requestedUrl);
  const resolvedId = stableJobIdentity(resolvedUrl);
  const titleMatches = pageTitleCandidates(html).some((title) => titlesLikelySame(expectedTitle, title));
  if (titleMatches) return "";
  if (expectedId && resolvedId === expectedId) return "official page shell does not expose the requisition";
  if (expectedId) return "redirected away from the requisition";
  return "official page does not identify the requisition";
}
