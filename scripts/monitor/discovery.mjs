import {
  discoveryConcurrency,
  discoveryErrorRefreshHours,
  discoveryLimit,
  discoveryRefreshHours,
  fetchTimeoutMs,
  sitemapDetailLimit,
} from "./config.mjs";
import { absoluteHttpUrl, mapConcurrent, normalize } from "./domain.mjs";
import { fetchDocument, fetchJson, fetchText, fetchWithRetries } from "./http.mjs";
import { amazonSearchUrl } from "./adapters/amazon.mjs";
import { oracleSearchUrl } from "./adapters/oracle.mjs";

const crawlerProduct = "CodexJobMonitor";
const discoveryStateVersion = 4;
const atsHosts = /(?:greenhouse\.io|lever\.co|ashbyhq\.com|myworkdayjobs\.com|avature\.net)$/i;
const knownJobPageHosts = /(?:smartrecruiters\.com|icims\.com|oraclecloud\.com|successfactors\.com|taleo\.net)$/i;
const genericJobDetailPatterns = [
  "/(?:jobs?|positions?|openings?|vacancies?)/[^/?#]+",
  "/careers?/jobs?/[^/?#]+",
  "/details/\\d{4,}[^/?#]*",
  "[?&](?:job_?id|job|req_?id|posting_?id)=",
];

function regexEscape(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function robotsRuleRegex(pattern) {
  const anchored = pattern.endsWith("$");
  const raw = anchored ? pattern.slice(0, -1) : pattern;
  const expression = raw.split("*").map(regexEscape).join(".*");
  return new RegExp(`^${expression}${anchored ? "$" : ""}`);
}

export function parseRobotsTxt(text, product = crawlerProduct) {
  const groups = [];
  const sitemaps = [];
  let current = null;
  let hasRules = false;
  for (const rawLine of String(text ?? "").split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const separator = line.indexOf(":");
    if (separator < 0) continue;
    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (field === "sitemap") {
      if (value) sitemaps.push(value);
      continue;
    }
    if (field === "user-agent") {
      if (!current || hasRules) {
        current = { agents: [], rules: [] };
        groups.push(current);
        hasRules = false;
      }
      current.agents.push(value.toLowerCase());
      continue;
    }
    if (!current || !["allow", "disallow"].includes(field)) continue;
    if (!value && field === "disallow") continue;
    current.rules.push({ allow: field === "allow", pattern: value, regex: robotsRuleRegex(value), specificity: value.replace(/[*$]/g, "").length });
    hasRules = true;
  }
  const token = product.toLowerCase();
  const exact = groups.filter((group) => group.agents.some((agent) => agent === token));
  const selected = exact.length > 0 ? exact : groups.filter((group) => group.agents.includes("*"));
  return { rules: selected.flatMap((group) => group.rules), sitemaps: [...new Set(sitemaps)] };
}

export function robotsAllows(url, robots) {
  if (!robots?.rules?.length) return true;
  const parsed = new URL(url);
  const path = `${parsed.pathname}${parsed.search}`;
  const matches = robots.rules.filter((rule) => rule.regex.test(path));
  if (matches.length === 0) return true;
  matches.sort((a, b) => b.specificity - a.specificity || Number(b.allow) - Number(a.allow));
  return matches[0].allow;
}

function decodeXml(value) {
  return normalize(value)
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'");
}

export function parseSitemapXml(xml) {
  const text = String(xml ?? "");
  const type = /<sitemapindex\b/i.test(text) ? "index" : "urlset";
  const tag = type === "index" ? "sitemap" : "url";
  const entries = [];
  for (const match of text.matchAll(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi"))) {
    const body = match[1];
    const loc = decodeXml(/<loc\b[^>]*>([\s\S]*?)<\/loc>/i.exec(body)?.[1] ?? "");
    if (!loc) continue;
    const lastmod = decodeXml(/<lastmod\b[^>]*>([\s\S]*?)<\/lastmod>/i.exec(body)?.[1] ?? "");
    entries.push({ loc, lastmod, type: type === "index" ? "sitemap" : "url" });
  }
  return entries;
}

export function looksLikeJobDetailUrl(value) {
  try {
    const url = new URL(value);
    const path = decodeURIComponent(url.pathname);
    return /\/(?:jobs?|positions?|openings?|vacancies?)\/[^/?#]{3,}/i.test(path)
      || /\/careers?\/jobs?\/[^/?#]{3,}/i.test(path)
      || /\/details\/\d{4,}[^/?#]*/i.test(path)
      || (url.hostname === "jobs.smartrecruiters.com" && /\/\d{4,}[^/]*$/i.test(path))
      || /[?&](?:job_?id|job|gh_jid|req_?id|posting_?id)=/i.test(url.search);
  } catch {
    return false;
  }
}

export function extractDocumentUrls(baseUrl, html) {
  const urls = [];
  for (const match of String(html ?? "").matchAll(/\b(?:href|src|action)=["']([^"']+)["']/gi)) {
    const resolved = absoluteHttpUrl(baseUrl, match[1].replace(/&amp;/gi, "&"));
    if (resolved) urls.push(resolved);
  }
  return [...new Set(urls)];
}

function sourceBase(target, adapter, extra) {
  return {
    company: target.company,
    adapter,
    priority: target.priority,
    source_kind: "discovered",
    discovered_from: target.career_url,
    ...extra,
  };
}

export function detectAtsSources(target, candidateUrls) {
  const sources = [];
  for (const value of candidateUrls) {
    let url;
    try {
      url = new URL(value);
    } catch {
      continue;
    }
    const host = url.hostname.toLowerCase();
    const segments = url.pathname.split("/").filter(Boolean);

    if (/^(?:boards|job-boards)(?:\.[a-z]{2})?\.greenhouse\.io$/.test(host) || host === "boards-api.greenhouse.io") {
      const board = url.searchParams.get("for") || (segments[0] === "v1" && segments[1] === "boards" ? segments[2] : segments[0]);
      if (board && !["embed", "jobs"].includes(board)) sources.push(sourceBase(target, "greenhouse", { board }));
    }
    if (/^(?:jobs|api)(?:\.eu)?\.lever\.co$/.test(host)) {
      const postingsIndex = segments.indexOf("postings");
      const site = postingsIndex >= 0 ? segments[postingsIndex + 1] : segments[0];
      if (site) sources.push(sourceBase(target, "lever", { site }));
    }
    if (host === "jobs.ashbyhq.com" || host === "api.ashbyhq.com") {
      const boardIndex = segments.indexOf("job-board");
      const board = boardIndex >= 0 ? segments[boardIndex + 1] : segments[0];
      if (board) sources.push(sourceBase(target, "ashby", { board }));
    }
    const workday = host.match(/^([^.]+)\.wd\d+\.myworkdayjobs\.com$/i);
    if (workday && segments[0]) {
      const jobIndex = segments.findIndex((segment) => segment.toLowerCase() === "job");
      const siteCandidates = [
        jobIndex > 0 ? segments[jobIndex - 1] : "",
        /^[a-z]{2}-[A-Z]{2}$/.test(segments[0]) ? segments[1] : "",
        segments[0],
      ].filter(Boolean);
      for (const site of siteCandidates) {
        sources.push(sourceBase(target, "workday", { host, tenant: workday[1], site, searchText: "new grad", limit: 20 }));
      }
    }
    if (host.endsWith(".avature.net")) {
      sources.push(sourceBase(target, "avature", { baseUrl: url.origin, searchText: "new grad", limit: 50 }));
    }
    if (host.endsWith(".oraclecloud.com")) {
      const sitesIndex = segments.findIndex((segment) => segment.toLowerCase() === "sites");
      const siteNumber = sitesIndex >= 0 ? segments[sitesIndex + 1] : "";
      if (siteNumber) {
        sources.push(sourceBase(target, "oracle", {
          baseUrl: url.origin,
          siteNumber,
          searchText: "2027",
          limit: 100,
        }));
      }
    }
    if (host === "lifeattiktok.com" || host === "careers.tiktok.com") {
      sources.push(sourceBase(target, "tiktok", {
        baseUrl: "https://api.lifeattiktok.com/api/v1/public/supplier",
        searchTexts: ["2027"],
        limit: 100,
      }));
    }
    if (host === "amazon.jobs" || host === "www.amazon.jobs") {
      sources.push(sourceBase(target, "amazon", {
        baseUrl: url.origin,
        searchTexts: ["2027", "early career", "software development engineer I", "engineering intern"],
        limit: 100,
        maxPages: 3,
      }));
    }
  }
  const seen = new Set();
  return sources.filter((source) => {
    const key = JSON.stringify([source.adapter, source.board, source.site, source.siteNumber, source.host, source.tenant, source.baseUrl]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function detectAtsSource(target, candidateUrls) {
  return detectAtsSources(target, candidateUrls)[0] ?? null;
}

async function verifyAtsSource(source) {
  if (source.adapter === "greenhouse") {
    const data = await fetchJson(`https://boards-api.greenhouse.io/v1/boards/${source.board}/jobs`, fetchTimeoutMs);
    return Array.isArray(data.jobs) ? data.jobs.length : 0;
  }
  if (source.adapter === "lever") {
    const jobs = await fetchJson(`https://api.lever.co/v0/postings/${source.site}?mode=json`, fetchTimeoutMs);
    return Array.isArray(jobs) ? jobs.length : 0;
  }
  if (source.adapter === "ashby") {
    const data = await fetchJson(`https://api.ashbyhq.com/posting-api/job-board/${source.board}`, fetchTimeoutMs);
    return (data.jobs ?? data.jobPostings ?? []).length;
  }
  if (source.adapter === "workday") {
    const url = `https://${source.host}/wday/cxs/${source.tenant}/${source.site}/jobs`;
    const data = await fetchWithRetries(url, "application/json,text/plain,*/*", (response) => response.json(), fetchTimeoutMs, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ limit: 1, offset: 0, searchText: "" }),
    });
    return Number(data.total) || (data.jobPostings ?? []).length;
  }
  if (source.adapter === "avature") {
    const document = await fetchDocument(`${source.baseUrl}/careers/SearchJobs/?jobRecordsPerPage=1&jobOffset=0&jobSearch=`, fetchTimeoutMs);
    return /<article\b|list-item-location|SearchJobs/i.test(document.text) ? 1 : 0;
  }
  if (source.adapter === "oracle") {
    const data = await fetchJson(oracleSearchUrl(source, "2027", 1, 0), fetchTimeoutMs);
    return Number(data?.items?.[0]?.TotalJobsCount ?? data?.items?.[0]?.totalJobsCount) || 0;
  }
  if (source.adapter === "tiktok") {
    const data = await fetchWithRetries(
      `${source.baseUrl}/search/job/posts`,
      "application/json,text/plain,*/*",
      (response) => response.json(),
      fetchTimeoutMs,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept-Language": "en-US",
          "Origin": "https://lifeattiktok.com",
          "website-path": "tiktok",
        },
        body: JSON.stringify({ keyword: "2027", limit: 1, offset: 0, recruitment_id_list: ["201", "202", "301"] }),
      },
    );
    return Number(data?.data?.count) || 0;
  }
  if (source.adapter === "amazon") {
    const data = await fetchJson(amazonSearchUrl(source, "early career", 1, 0), fetchTimeoutMs);
    return Number(data?.hits) || (data?.jobs ?? []).length;
  }
  return 0;
}

async function selectVerifiedAtsSource(target, candidateUrls) {
  const candidates = detectAtsSources(target, candidateUrls).slice(0, 16);
  if (candidates.length === 0) return null;
  const verified = [];
  let retryableError = null;
  for (const candidate of candidates) {
    try {
      const openJobs = await verifyAtsSource(candidate);
      if (openJobs > 0) verified.push({ source: candidate, openJobs });
    } catch (error) {
      if (/429|5\d\d|fetch failed|timed out|timeout/i.test(error.message)) retryableError = error;
    }
  }
  verified.sort((a, b) => b.openJobs - a.openJobs);
  if (verified[0]) return { ...verified[0].source, verified_open_jobs: verified[0].openJobs };
  if (retryableError) throw new Error(`ATS fingerprint verification failed: ${retryableError.message}`);
  return null;
}

function containsJobPostingJsonLd(html) {
  for (const match of String(html ?? "").matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    if (/"@type"\s*:\s*(?:"JobPosting"|\[[^\]]*"JobPosting")/i.test(match[1])) return true;
  }
  return false;
}

async function fetchRobots(origin) {
  const url = `${origin}/robots.txt`;
  try {
    return { url, parsed: parseRobotsTxt(await fetchText(url, fetchTimeoutMs)), status: "ok" };
  } catch (error) {
    if (/\b5\d\d\b|fetch failed|timed out|timeout/i.test(error.message)) throw new Error(`robots.txt unreachable: ${error.message}`);
    return { url, parsed: { rules: [], sitemaps: [] }, status: "unavailable" };
  }
}

async function sitemapEvidence(target, robots) {
  const origin = new URL(target.career_url).origin;
  const roots = robots.parsed.sitemaps.length > 0 ? robots.parsed.sitemaps : [`${origin}/sitemap.xml`];
  const inspected = [];
  const pageUrls = [];
  for (const sitemapUrl of roots.slice(0, 4)) {
    try {
      const xml = await fetchText(sitemapUrl, fetchTimeoutMs);
      inspected.push(sitemapUrl);
      const entries = parseSitemapXml(xml);
      if (entries[0]?.type === "sitemap") {
        const nested = entries
          .sort((a, b) => Number(/job|career|position|vacanc/i.test(b.loc)) - Number(/job|career|position|vacanc/i.test(a.loc)))
          .slice(0, 4);
        for (const entry of nested) {
          try {
            const nestedXml = await fetchText(entry.loc, fetchTimeoutMs);
            inspected.push(entry.loc);
            pageUrls.push(...parseSitemapXml(nestedXml).filter((item) => item.type === "url").map((item) => item.loc));
          } catch {
            // A partial sitemap index is still useful.
          }
        }
      } else {
        pageUrls.push(...entries.map((entry) => entry.loc));
      }
    } catch {
      // Common sitemap paths frequently do not exist.
    }
  }
  const ats = await selectVerifiedAtsSource(target, pageUrls);
  if (ats) return { source: ats, inspected, jobUrls: [] };
  const jobUrls = [...new Set(pageUrls)]
    .filter(looksLikeJobDetailUrl)
    .filter((url) => {
      try {
        const parsed = new URL(url);
        return parsed.origin === origin || atsHosts.test(parsed.hostname);
      } catch {
        return false;
      }
    })
    .filter((url) => new URL(url).origin !== origin || robotsAllows(url, robots.parsed))
    .slice(0, sitemapDetailLimit);
  return { source: null, inspected, jobUrls };
}

export async function discoverTargetSource(target) {
  const initialUrl = new URL(target.career_url);
  const robots = await fetchRobots(initialUrl.origin);
  if (!robotsAllows(target.career_url, robots.parsed)) {
    return { status: "blocked", reason: "career URL disallowed by robots.txt", robots_url: robots.url };
  }

  const document = await fetchDocument(target.career_url, fetchTimeoutMs);
  const links = extractDocumentUrls(document.url, document.text);
  const candidates = [target.career_url, document.url, ...links];
  const ats = await selectVerifiedAtsSource(target, candidates);
  if (ats) return { status: "discovered", source: ats, method: "ats-fingerprint", robots_url: robots.url };

  if (containsJobPostingJsonLd(document.text)) {
    return {
      status: "discovered",
      source: sourceBase(target, "html_jobs", { urls: [document.url], forceDetail: true, detailLimit: 1 }),
      method: "jobposting-jsonld",
      robots_url: robots.url,
    };
  }

  const linkedJobUrls = links
    .filter(looksLikeJobDetailUrl)
    .filter((url) => new URL(url).origin === initialUrl.origin || knownJobPageHosts.test(new URL(url).hostname))
    .filter((url) => new URL(url).origin !== initialUrl.origin || robotsAllows(url, robots.parsed))
    .slice(0, sitemapDetailLimit);
  if (linkedJobUrls.length > 0) {
    return {
      status: "discovered",
      source: sourceBase(target, "html_jobs", {
        urls: [document.url],
        relativeJobBase: document.url,
        detailUrlPatterns: genericJobDetailPatterns,
        keepDetailQuery: true,
        detailLimit: sitemapDetailLimit,
      }),
      method: "official-job-links",
      robots_url: robots.url,
    };
  }

  const sitemap = await sitemapEvidence(target, robots);
  if (sitemap.source) return { status: "discovered", source: sitemap.source, method: "sitemap-ats-fingerprint", robots_url: robots.url };
  if (sitemap.jobUrls.length > 0) {
    return {
      status: "discovered",
      source: sourceBase(target, "sitemap_jobs", { sitemaps: sitemap.inspected, robotsUrl: robots.url, detailLimit: sitemapDetailLimit }),
      method: "job-sitemap",
      robots_url: robots.url,
    };
  }
  return { status: "none", reason: "no supported ATS, JobPosting JSON-LD, official job links, or job sitemap found", robots_url: robots.url };
}

function checkedAgeHours(record, nowMs) {
  const checked = Date.parse(record?.checked_at ?? "");
  return Number.isNaN(checked) ? Number.POSITIVE_INFINITY : (nowMs - checked) / 3600000;
}

export async function discoverSources(targets, configuredSources, previousState = {}) {
  const now = new Date();
  const nowMs = now.getTime();
  const configuredCompanies = new Set(configuredSources.map((source) => source.company.toLowerCase()));
  // Discovery records remain useful when the schema version changes. New fields
  // are filled on refresh, while preserving coverage avoids starving the board.
  const companies = previousState?.companies && typeof previousState.companies === "object"
    ? { ...previousState.companies }
    : {};
  const eligibleTargets = targets.filter((target) => !configuredCompanies.has(target.company.toLowerCase()));
  const due = eligibleTargets
    .filter((target) => {
      const record = companies[target.company.toLowerCase()];
      const refreshHours = record?.status === "error" || record?.last_scan_status === "error"
        ? discoveryErrorRefreshHours
        : discoveryRefreshHours;
      return checkedAgeHours(record, nowMs) >= refreshHours;
    })
    .sort((a, b) => Date.parse(companies[a.company.toLowerCase()]?.checked_at ?? 0) - Date.parse(companies[b.company.toLowerCase()]?.checked_at ?? 0));
  const selected = due.slice(0, discoveryLimit);

  const results = await mapConcurrent(selected, discoveryConcurrency, async (target) => {
    try {
      return { target, ...(await discoverTargetSource(target)) };
    } catch (error) {
      return { target, status: "error", reason: error.message };
    }
  });
  for (const result of results) {
    companies[result.target.company.toLowerCase()] = {
      company: result.target.company,
      checked_at: now.toISOString(),
      status: result.status,
      method: result.method ?? "",
      reason: result.reason ?? "",
      robots_url: result.robots_url ?? "",
      source: result.source ?? null,
    };
  }

  const activeCompanyKeys = new Set(eligibleTargets.map((target) => target.company.toLowerCase()));
  for (const key of Object.keys(companies)) {
    if (!activeCompanyKeys.has(key)) delete companies[key];
  }
  const sources = Object.values(companies)
    .filter((record) => record.status === "discovered" && record.source)
    .map((record) => record.source);
  return {
    state: {
      version: discoveryStateVersion,
      updated_at: results.length > 0 ? now.toISOString() : (previousState.updated_at ?? now.toISOString()),
      companies,
    },
    sources,
    attempted: results.length,
    discovered_now: results.filter((result) => result.status === "discovered").length,
    due_remaining: Math.max(due.length - selected.length, 0),
    status_counts: Object.values(companies).reduce((counts, record) => {
      counts[record.status] = (counts[record.status] ?? 0) + 1;
      return counts;
    }, {}),
  };
}
