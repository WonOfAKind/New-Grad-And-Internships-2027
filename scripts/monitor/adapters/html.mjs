import { fetchTimeoutMs, htmlDetailConcurrency } from "../config.mjs";
import {
  categorize,
  chooseResume,
  cleanCompensationText,
  extractCompensation,
  fitNotes,
  graduationMatch,
  hasOnlyExcludedGraduationWindow,
  isEligibleRole,
  isRelevant,
  mapConcurrent,
  normalize,
  priorityFor,
  tailoringNotes,
} from "../domain.mjs";
import { fetchText } from "../http.mjs";
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
    resume_choice: resumeChoice,
    priority: priorityFor(title, source.priority),
    direct_apply_url: job.url,
    career_source_url: sourceForCompany(source.company)?.career_url ?? job.url,
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

export function structuredLocationText(location) {
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

export function htmlDetailContent(html, source = {}, structuredJob = null) {
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
          "User-Agent": "Mozilla/5.0",
          "Accept": "text/html,*/*",
        },
      });
      successfulPages += 1;
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
    } catch {
      // One malformed or blocked detail page should not discard other valid jobs.
    }
  });

  return [...leadByUrl.values()];
}

async function collectSitemapJobUrls(source, timeoutMs) {
  const queue = (source.sitemaps ?? []).map((url) => ({ url, depth: 0 }));
  const visited = new Set();
  const pages = [];
  while (queue.length > 0 && visited.size < 12) {
    const item = queue.shift();
    if (!item?.url || visited.has(item.url)) continue;
    visited.add(item.url);
    const entries = parseSitemapXml(await fetchText(item.url, timeoutMs));
    for (const entry of entries) {
      if (entry.type === "sitemap" && item.depth < 1) queue.push({ url: entry.loc, depth: item.depth + 1 });
      if (entry.type === "url" && looksLikeJobDetailUrl(entry.loc)) pages.push(entry);
    }
  }
  const titleFromUrl = (value) => {
    try {
      return decodeURIComponent(new URL(value).pathname.split("/").filter(Boolean).pop() ?? "").replace(/[-_]+/g, " ");
    } catch {
      return "";
    }
  };
  return pages
    .sort((a, b) => {
      const aTitle = titleFromUrl(a.loc);
      const bTitle = titleFromUrl(b.loc);
      const aScore = (isEligibleRole(aTitle) ? 2 : 0) + (isRelevant(aTitle) ? 1 : 0);
      const bScore = (isEligibleRole(bTitle) ? 2 : 0) + (isRelevant(bTitle) ? 1 : 0);
      return bScore - aScore || Date.parse(b.lastmod || 0) - Date.parse(a.lastmod || 0);
    })
    .map((entry) => entry.loc);
}

export async function scanSitemapJobs(source, timeoutMs = fetchTimeoutMs) {
  let robots = { rules: [] };
  if (source.robotsUrl) {
    try {
      robots = parseRobotsTxt(await fetchText(source.robotsUrl, timeoutMs));
    } catch (error) {
      if (/\b5\d\d\b|fetch failed|timed out|timeout/i.test(error.message)) throw error;
    }
  }
  const urls = (await collectSitemapJobUrls(source, timeoutMs))
    .filter((url) => robotsAllows(url, robots))
    .slice(0, source.detailLimit ?? 80);
  const leads = await mapConcurrent(urls, htmlDetailConcurrency, async (url) => {
    try {
      const html = await fetchText(url, timeoutMs, { headers: { "User-Agent": "Mozilla/5.0", "Accept": "text/html,*/*" } });
      const job = htmlJobFromDetail(source, url, html);
      const context = `${job.location}\n${job.description}`;
      if (!isRelevant(job.title) || !isEligibleRole(job.title, context) || hasOnlyExcludedGraduationWindow(job.title, context)) return null;
      return htmlJobToLead(source, job);
    } catch {
      return null;
    }
  });
  return leads.filter(Boolean);
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
