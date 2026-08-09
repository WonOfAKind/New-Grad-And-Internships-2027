import { fetchTimeoutMs, htmlDetailConcurrency, userAgent } from "../config.mjs";
import {
  categorize,
  chooseResume,
  cleanCompensationText,
  extractCompensation,
  fitNotes,
  graduationMatch,
  hasOnlyExcludedGraduationWindow,
  isAllowedLocation,
  isEligibleRole,
  isProbablySenior,
  isRelevant,
  mapConcurrent,
  normalize,
  normalizePostingDate,
  priorityFor,
  tailoringNotes,
} from "../domain.mjs";
import { fetchText } from "../http.mjs";
import { closedPageReason } from "../lifecycle.mjs";
import {
  looksLikeJobDetailUrl,
  parseRobotsTxt,
  parseSitemapXml,
  robotsAllows,
} from "../discovery.mjs";
import { sourceForCompany } from "./context.mjs";
import { stripHtml } from "./providers.mjs";

export function htmlAttributeContent(html, attributeName) {
  const escapedName = attributeName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const afterName = new RegExp(`<meta\\s+[^>]*(?:name|property)=["']${escapedName}["'][^>]*content=["']([^"']*)["'][^>]*>`, "i");
  const beforeName = new RegExp(`<meta\\s+[^>]*content=["']([^"']*)["'][^>]*(?:name|property)=["']${escapedName}["'][^>]*>`, "i");
  return cleanCompensationText(afterName.exec(html)?.[1] ?? beforeName.exec(html)?.[1] ?? "");
}

export function htmlLinkHref(html, relName) {
  const escapedName = relName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const afterRel = new RegExp(`<link\\s+[^>]*rel=["'][^"']*${escapedName}[^"']*["'][^>]*href=["']([^"']*)["'][^>]*>`, "i");
  const beforeRel = new RegExp(`<link\\s+[^>]*href=["']([^"']*)["'][^>]*rel=["'][^"']*${escapedName}[^"']*["'][^>]*>`, "i");
  return cleanCompensationText(afterRel.exec(html)?.[1] ?? beforeRel.exec(html)?.[1] ?? "");
}

export function googleCareersUrl(baseUrl, href) {
  const value = normalize(href);
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith("/about/careers/")) return `https://www.google.com${value}`;
  if (value.startsWith("jobs/results/")) return `https://www.google.com/about/careers/applications/${value}`;
  return new URL(value, baseUrl).toString();
}

export function googleTitleFromHtml(html) {
  const metaTitle = htmlAttributeContent(html, "og:title") || htmlAttributeContent(html, "twitter:title");
  const title = metaTitle || cleanCompensationText(/<title>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "");
  return title.replace(/\s+(?:-|Ã¢â‚¬â€)\s+Google Careers$/i, "").trim();
}

export function googleDetailContent(html) {
  const description = htmlAttributeContent(html, "description");
  const start = html.search(/<h3>\s*Minimum qualifications/i);
  const body = start >= 0
    ? html.slice(start, Math.min(html.length, start + 35000))
    : "";
  return cleanCompensationText(`${description}\n${stripHtml(body)}`);
}

export function googleCardSummaries(baseUrl, html) {
  return [...html.matchAll(/<a\s+class=["'][^"']*\bSi6A0c\b[^"']*["']\s+href=["']([^"']+)["']>([\s\S]*?)<\/a>/gi)]
    .map((match) => {
      const card = match[2] ?? "";
      const title = cleanCompensationText(/<h3[^>]*>([\s\S]*?)<\/h3>/i.exec(card)?.[1] ?? "");
      const location = cleanCompensationText(stripHtml(/<p[^>]*>([\s\S]*?)<\/p>/i.exec(card)?.[1] ?? ""));
      return { title, location, url: googleCareersUrl(baseUrl, match[1]) };
    })
    .filter((job) => job.title && job.url);
}

export function googleJobToLead(source, job) {
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
    description: content,
    resume_choice: resumeChoice,
    priority: priorityFor(title, source.priority),
    direct_apply_url: job.url,
    career_source_url: sourceForCompany(source.company)?.career_url ?? job.url,
    lead_status: "Tailor Resume",
    posted_at: normalizePostingDate(job.datePosted ?? job.date_posted ?? ""),
    expires_at: normalizePostingDate(job.validThrough ?? job.valid_through ?? ""),
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

export function htmlJobUrl(source, baseUrl, href) {
  const value = normalize(href).replace(/&amp;/gi, "&");
  if (!value) return "";
  try {
    const resolved = /^https?:\/\//i.test(value) ? new URL(value).toString() : new URL(value, source.relativeJobBase ?? baseUrl).toString();
    if (source.keepDetailQuery === true) return resolved;
    const parsed = new URL(resolved);
    const withoutQuery = `${parsed.origin}${parsed.pathname}`;
    if (htmlDetailPatterns(source).some((pattern) => pattern.test(withoutQuery) || pattern.test(resolved))) {
      return withoutQuery;
    }
    return resolved;
  } catch {
    return "";
  }
}

export function htmlDetailPatterns(source) {
  const patterns = source.detailUrlPatterns ?? [
    "/jobs/results/\\d+",
    "/careers/(?:job|jobs|positions?)/",
    "/jobs/[^/?#]+",
  ];
  return patterns.map((pattern) => new RegExp(pattern, "i"));
}

export function isHtmlDetailUrl(source, url) {
  return htmlDetailPatterns(source).some((pattern) => pattern.test(url));
}

export function htmlCanonicalJobUrl(source, baseUrl, html, fallbackUrl) {
  const canonical = htmlLinkHref(html, "canonical")
    || htmlAttributeContent(html, "og:url")
    || htmlAttributeContent(html, "twitter:url")
    || fallbackUrl;
  return htmlJobUrl(source, baseUrl, canonical);
}

export function htmlTitleFromHtml(html, source = {}) {
  const metaTitle = htmlAttributeContent(html, "og:title") || htmlAttributeContent(html, "twitter:title");
  const h1Title = cleanCompensationText(/<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1] ?? "");
  const title = metaTitle || h1Title || cleanCompensationText(/<title>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "");
  const suffixPattern = source.titleSuffixPattern
    ? new RegExp(source.titleSuffixPattern, "i")
    : /\s+(?:-|[\u2013\u2014])\s+[^|]+(?:careers|jobs)$/i;
  return title.replace(suffixPattern, "").trim();
}

export function jsonLdObjects(html) {
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

export function collectJobPostingNodes(value, nodes = []) {
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

export function htmlStructuredJobPostings(html) {
  return jsonLdObjects(html).flatMap((object) => collectJobPostingNodes(object));
}

export function htmlMicrodataJobPosting(html) {
  if (!/itemtype=["']https?:\/\/schema\.org\/JobPosting["']/i.test(html)) return null;
  const contentFor = (property) => {
    const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const afterProperty = new RegExp(`<meta\\s+[^>]*itemprop=["']${escaped}["'][^>]*content=["']([^"']*)["'][^>]*>`, "i");
    const beforeProperty = new RegExp(`<meta\\s+[^>]*content=["']([^"']*)["'][^>]*itemprop=["']${escaped}["'][^>]*>`, "i");
    return cleanCompensationText(afterProperty.exec(html)?.[1] ?? beforeProperty.exec(html)?.[1] ?? "");
  };
  const title = cleanCompensationText(/<h1\b[^>]*itemprop=["']title["'][^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1] ?? "");
  const location = [contentFor("addressLocality"), contentFor("addressRegion"), contentFor("addressCountry")]
    .filter(Boolean)
    .join(", ");
  return {
    "@type": "JobPosting",
    title,
    jobLocation: location,
    datePosted: contentFor("datePosted"),
    validThrough: contentFor("validThrough"),
  };
}

export function structuredLocationText(location) {
  const locations = Array.isArray(location) ? location : [location];
  return locations
    .map((item) => {
      if (!item || typeof item !== "object") return normalize(item);
      const address = item.address && typeof item.address === "object" ? item.address : item;
      const scalar = (value) => {
        if (value == null) return "";
        if (typeof value !== "object") return normalize(value);
        return scalar(value.name ?? value.value ?? value.label ?? "");
      };
      const parts = [item.name, address.addressLocality, address.addressRegion, address.addressCountry]
        .flatMap((value) => scalar(value).split(/\s*,\s*/))
        .map(normalize)
        .filter(Boolean);
      return [...new Set(parts)].join(", ");
    })
    .filter(Boolean)
    .join("; ");
}

export function htmlDetailContent(html, source = {}, structuredJob = null) {
  // A real JobPosting description is authoritative. Page-level meta
  // descriptions are frequently generic employer marketing copy and used to
  // hide the degree/experience evidence needed for early-career validation.
  const description = stripHtml(structuredJob?.description ?? "") || htmlAttributeContent(html, "description");
  const startPattern = source.contentStartPattern
    ? new RegExp(source.contentStartPattern, "i")
    : /itemprop=["']description["']|<h[1-4][^>]*>\s*(?:Minimum qualifications|Required qualifications|Requirements|Responsibilities|About the job|About this role|Job description|What you'll do)/i;
  const start = html.search(startPattern);
  const mainMatch = /<main[\s\S]*?<\/main>/i.exec(html);
  const bodyMatch = /<body[\s\S]*?<\/body>/i.exec(html);
  const body = start >= 0
    ? html.slice(start, Math.min(html.length, start + 35000))
    : (mainMatch?.[0] ?? bodyMatch?.[0] ?? html.slice(0, 50000));
  return cleanCompensationText(`${description}\n${stripHtml(body)}`);
}

export function htmlCardSummaries(source, baseUrl, html) {
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

export function htmlJobFromDetail(source, url, html, seed = {}) {
  const structuredJob = htmlStructuredJobPostings(html)[0] ?? htmlMicrodataJobPosting(html);
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

export function htmlJobToLead(source, job) {
  return googleJobToLead(source, job);
}
export async function scanHtmlJobs(source, timeoutMs = fetchTimeoutMs) {
  const sourceUrls = source.urls ?? (source.url ? [source.url] : []);
  const leadByUrl = new Map();
  const detailCandidates = new Map();
  const detailLimit = source.detailLimit ?? 8;
  const pageErrors = [];
  let successfulPages = 0;

  for (const url of sourceUrls) {
    try {
      const html = await fetchText(url, timeoutMs, {
        headers: {
          "User-Agent": userAgent,
          "Accept": "text/html,*/*",
        },
      });
      successfulPages += 1;
      if (closedPageReason(200, html)) continue;
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
    } catch (error) {
      pageErrors.push(error);
    }
  }
  if (successfulPages === 0 && pageErrors.length > 0) throw pageErrors.at(-1);

  await mapConcurrent([...detailCandidates.values()].slice(0, detailLimit), htmlDetailConcurrency, async (job) => {
    if (leadByUrl.has(job.url)) return;
    try {
      const html = await fetchText(job.url, timeoutMs, {
        headers: {
          "User-Agent": userAgent,
          "Accept": "text/html,*/*",
        },
      });
      if (closedPageReason(200, html)) return;
      const enrichedJob = htmlJobFromDetail(source, job.url, html, job);
      const context = `${enrichedJob.location}\n${enrichedJob.description}`;
      if (!isRelevant(enrichedJob.title, context)) return;
      if (!isEligibleRole(enrichedJob.title, context)) return;
      if (hasOnlyExcludedGraduationWindow(enrichedJob.title, context)) return;
      leadByUrl.set(enrichedJob.url, htmlJobToLead(source, enrichedJob));
    } catch {
      // One malformed or blocked detail page should not discard other valid jobs.
    }
  });

  return [...leadByUrl.values()];
}

export function titleFromJobUrl(value) {
  try {
    const segments = new URL(value).pathname.split("/").filter(Boolean).map(decodeURIComponent);
    const jobIndex = segments.findIndex((segment) => /^jobs?$/i.test(segment));
    const candidateSegments = jobIndex >= 0 && jobIndex < segments.length - 1
      ? segments.slice(jobIndex + 1)
      : (jobIndex > 0 ? segments.slice(0, jobIndex) : segments);
    const candidates = candidateSegments
      .filter((segment) => !/^\d+$/.test(segment))
      .filter((segment) => !/^[A-F\d]{20,}$/i.test(segment))
      .map((segment) => segment.replace(/[-_]+/g, " "));
    return candidates.sort((a, b) => {
      const score = (title) => sitemapTitlePriority(title) + Math.min(title.length, 120) / 120;
      return score(b) - score(a);
    })[0] ?? "";
  } catch {
    return "";
  }
}

export function sitemapLocationFromJobUrl(value) {
  try {
    const segments = new URL(value).pathname.split("/").filter(Boolean).map(decodeURIComponent);
    const jobIndex = segments.findIndex((segment) => /^jobs?$/i.test(segment));
    if (jobIndex !== segments.length - 1 || segments.length < 4) return "";
    const locationSlug = segments.at(-4);
    const parts = locationSlug.split("-").filter(Boolean);
    if (parts.length < 2) return "";
    const region = parts.pop().toUpperCase();
    const city = parts.map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1).toLowerCase()}`).join(" ");
    return `${city}, ${region}`;
  } catch {
    return "";
  }
}

export function sitemapTitlePriority(title) {
  const juniorMarker = /\b(?:2027|intern(?:ship)?|co[-\s]?op|entry[-\s]?level|early[-\s]?career|new\s+grad|recent\s+grad|junior|associate(?:\s+staff|\s+level)?|engineer\s+(?:level\s*)?(?:i|1))\b/i.test(title);
  const physicalEngineering = /\b(?:mechanical|aerospace|aeronautical|structural|thermal|propulsion|flight|avionics|systems?|test|quality|manufacturing|materials?|weld|product\s+(?:development|review)|liaison|airworthiness|radar)\b/i.test(title);
  return (juniorMarker ? 12 : 0)
    + (isEligibleRole(title) ? 6 : 0)
    + (isRelevant(title) ? 3 : 0)
    + (physicalEngineering ? 2 : 0)
    - (isProbablySenior(title) ? 20 : 0);
}

async function collectSitemapJobUrls(source, timeoutMs) {
  const queue = (source.sitemaps ?? []).map((url) => ({ url, depth: 0 }));
  const visited = new Set();
  const pages = [];
  const requestHeaders = source.userAgent ? { "User-Agent": source.userAgent } : undefined;
  const configuredJobPatterns = (source.sitemapJobUrlPatterns ?? []).map((pattern) => new RegExp(pattern, "i"));
  const isJobUrl = (url) => looksLikeJobDetailUrl(url) || configuredJobPatterns.some((pattern) => pattern.test(url));
  while (queue.length > 0 && visited.size < 12) {
    const item = queue.shift();
    if (!item?.url || visited.has(item.url)) continue;
    visited.add(item.url);
    const entries = parseSitemapXml(await fetchText(item.url, timeoutMs, requestHeaders ? { headers: requestHeaders } : {}));
    for (const entry of entries) {
      if (entry.type === "sitemap" && item.depth < 1) queue.push({ url: entry.loc, depth: item.depth + 1 });
      if (entry.type === "url" && isJobUrl(entry.loc)) pages.push(entry);
    }
  }
  return pages
    .sort((a, b) => {
      const aTitle = titleFromJobUrl(a.loc);
      const bTitle = titleFromJobUrl(b.loc);
      const aScore = sitemapTitlePriority(aTitle);
      const bScore = sitemapTitlePriority(bTitle);
      return bScore - aScore || Date.parse(b.lastmod || 0) - Date.parse(a.lastmod || 0);
    })
    .map((entry) => entry.loc);
}

export async function scanSitemapJobs(source, timeoutMs = fetchTimeoutMs) {
  const requestHeaders = { "User-Agent": source.userAgent ?? userAgent, "Accept": "text/html,*/*" };
  let robots = { rules: [] };
  if (source.robotsUrl) {
    try {
      robots = parseRobotsTxt(await fetchText(source.robotsUrl, timeoutMs, { headers: requestHeaders }));
    } catch (error) {
      if (/\b5\d\d\b|fetch failed|timed out|timeout/i.test(error.message)) throw error;
    }
  }
  const urls = (await collectSitemapJobUrls(source, timeoutMs))
    .filter((url) => robotsAllows(url, robots))
    .slice(0, source.detailLimit ?? 80);
  const leads = await mapConcurrent(urls, source.detailConcurrency ?? htmlDetailConcurrency, async (url) => {
    const fallbackJob = {
      title: source.titleCaseSitemapFallback
        ? titleFromJobUrl(url).replace(/\b[a-z]/g, (letter) => letter.toUpperCase())
        : titleFromJobUrl(url),
      location: sitemapLocationFromJobUrl(url) || normalize(source.location),
      description: "",
      url,
    };
    const eligibleFallback = () => source.allowSitemapTitleFallback
      && isRelevant(fallbackJob.title, fallbackJob.location)
      && isEligibleRole(fallbackJob.title, fallbackJob.location)
      && !hasOnlyExcludedGraduationWindow(fallbackJob.title, fallbackJob.location)
      && (!source.requireUnitedStates || isAllowedLocation(fallbackJob));
    try {
      const detailUrl = source.detailUrlSuffix ? `${url}${source.detailUrlSuffix}` : url;
      const html = await fetchText(detailUrl, timeoutMs, { headers: requestHeaders });
      if (closedPageReason(200, html)) return null;
      const job = htmlJobFromDetail(source, url, html);
      const context = `${job.location}\n${job.description}`;
      if (!isRelevant(job.title, context) || !isEligibleRole(job.title, context) || hasOnlyExcludedGraduationWindow(job.title, context)) {
        return eligibleFallback() ? htmlJobToLead(source, fallbackJob) : null;
      }
      return htmlJobToLead(source, job);
    } catch {
      return eligibleFallback() ? htmlJobToLead(source, fallbackJob) : null;
    }
  });
  return leads.filter(Boolean);
}

function rssElement(body, tagName) {
  const escaped = tagName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const value = new RegExp(`<${escaped}\\b[^>]*>([\\s\\S]*?)<\\/${escaped}>`, "i").exec(body)?.[1] ?? "";
  return value.replace(/^\s*<!\[CDATA\[/i, "").replace(/\]\]>\s*$/i, "").trim();
}

export function parseRssJobs(xml) {
  const jobs = [];
  for (const match of String(xml ?? "").matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const body = match[1];
    const title = cleanCompensationText(rssElement(body, "title"));
    const description = cleanCompensationText(rssElement(body, "description"));
    const location = cleanCompensationText(rssElement(body, "g:location"));
    const url = cleanCompensationText(rssElement(body, "link"));
    if (!title || !url) continue;
    jobs.push({
      title,
      description,
      location,
      url,
      validThrough: cleanCompensationText(rssElement(body, "g:expiration_date")),
    });
  }
  return jobs;
}

export async function scanRssJobs(source, timeoutMs = fetchTimeoutMs) {
  const jobs = parseRssJobs(await fetchText(source.url, timeoutMs, {
    headers: { "User-Agent": userAgent, "Accept": "application/rss+xml,application/xml,text/xml,*/*" },
  }));
  return jobs
    .filter((job) => !source.requireUnitedStates || isAllowedLocation(job))
    .filter((job) => {
      const context = `${job.location}\n${job.description}`;
      return isRelevant(job.title, context)
        && isEligibleRole(job.title, context)
        && !hasOnlyExcludedGraduationWindow(job.title, context);
    })
    .map((job) => htmlJobToLead(source, job));
}

export async function scanGoogleCareers(source, timeoutMs = fetchTimeoutMs) {
  return scanHtmlJobs({
    relativeJobBase: "https://www.google.com/about/careers/applications/",
    detailUrlPatterns: ["/jobs/results/\\d+"],
    contentStartPattern: "<h3>\\s*Minimum qualifications",
    titleSuffixPattern: "\\s+(?:-|[\\u2013\\u2014])\\s+Google Careers$",
    ...source,
  }, timeoutMs);
}
