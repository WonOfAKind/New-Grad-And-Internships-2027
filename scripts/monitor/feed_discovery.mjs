import {
  discoveryFeedConcurrency,
  discoveryFeedReverifyHours,
  discoveryFeedTimeoutMs,
  discoveryFeedVerifyLimit,
  discoveryVerificationVersion,
} from "./config.mjs";
import {
  canonicalApplyUrl,
  dateOnly,
  hasOnlyExcludedGraduationWindow,
  isEligibleRole,
  isDirectEmployerApplyUrl,
  isRelevant,
  keyFor,
  mapConcurrent,
  normalize,
  normalizeCompanyName,
  normalizePostingDate,
  normalizeRoleTitle,
  roleType,
} from "./domain.mjs";
import { fetchDocument, fetchJson, fetchText } from "./http.mjs";
import { htmlJobFromDetail, htmlJobToLead } from "./adapters/html.mjs";
import { officialPageRejection } from "./official_page.mjs";

const blockedDiscoveryHosts = [
  /(^|\.)github\.com$/i,
  /(^|\.)githubusercontent\.com$/i,
  /(^|\.)linkedin\.com$/i,
  /(^|\.)indeed\.com$/i,
  /(^|\.)glassdoor\.com$/i,
  /(^|\.)simplify\.jobs$/i,
  /(^|\.)zapplyjobs\.com$/i,
  /(^|\.)speedyapply\.com$/i,
  /(^|\.)internship-radar-2027\.yuxhuang\.com$/i,
  /(^|\.)ripplematch\.com$/i,
  /(^|\.)joinhandshake\.com$/i,
  /(^|\.)handshake\.com$/i,
  /(^|\.)wayup\.com$/i,
  /(^|\.)tinyurl\.com$/i,
  /(^|\.)bit\.ly$/i,
];

const nonJobExtensions = /\.(?:png|jpe?g|gif|svg|webp|ico|pdf)(?:$|\?)/i;
const jobUrlEvidence = /(?:jobs?|careers?|positions?|openings?|postings?|recruit|workdayjobs|greenhouse|lever|ashby|smartrecruiters|jobvite|icims|successfactors|oraclecloud|myworkday)/i;

export function validateDiscoveryFeeds(feeds) {
  if (!Array.isArray(feeds) || feeds.length === 0) throw new Error("data/discovery_feeds.json must contain at least one feed");
  const names = new Set();
  for (const [index, feed] of feeds.entries()) {
    const label = `discovery_feeds.json[${index}]`;
    if (!normalize(feed?.name)) throw new Error(`${label}.name is required`);
    if (names.has(feed.name)) throw new Error(`Duplicate discovery feed: ${feed.name}`);
    names.add(feed.name);
    try {
      if (!/^https?:$/.test(new URL(feed.url).protocol)) throw new Error();
    } catch {
      throw new Error(`${label}.url must be an HTTP(S) URL`);
    }
    if (!["json", "markdown"].includes(feed.format)) throw new Error(`${label}.format must be json or markdown`);
    if (!/2027/i.test(normalize(feed.season_hint))) throw new Error(`${label}.season_hint must explicitly identify the 2027 cycle`);
  }
}

export function decodeFeedText(value) {
  return normalize(String(value ?? "")
    .replace(/<br\s*\/?>/gi, "; ")
    .replace(/<[^>]+>/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_`~]/g, "")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&ndash;|&mdash;|&#8211;|&#8212;/gi, "-")
    .replace(/&#x27;|&#39;/gi, "'")
    .replace(/&quot;/gi, "\"")
    .replace(/\s+/g, " "));
}

export function urlsFromFeedRow(row) {
  const urls = [];
  for (const match of row.matchAll(/https?:\/\/[^\s"'<>)]*/gi)) {
    const url = match[0].replace(/[.,;]+$/, "");
    if (!urls.includes(url)) urls.push(url);
  }
  return urls;
}

export function isOfficialJobUrl(value) {
  try {
    const parsed = new URL(value);
    if (!/^https?:$/.test(parsed.protocol)) return false;
    if (blockedDiscoveryHosts.some((pattern) => pattern.test(parsed.hostname)) || !isDirectEmployerApplyUrl(value)) return false;
    if (nonJobExtensions.test(parsed.pathname)) return false;
    return jobUrlEvidence.test(`${parsed.hostname}${parsed.pathname}`)
      || /(?:\d{6,}|[0-9a-f]{8}-[0-9a-f-]{27,})/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

export function applyUrlFromFeedRow(row) {
  const candidates = urlsFromFeedRow(row).filter(isOfficialJobUrl);
  return candidates.sort((a, b) => {
    const applyScore = (value) => /(?:apply|job\/|jobs\/|jobid|gh_jid|requisition)/i.test(value) ? 1 : 0;
    return applyScore(b) - applyScore(a);
  })[0] ?? "";
}

function splitMarkdownRow(line) {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
}

function headerIndex(headers, patterns, fallback = -1) {
  return headers.findIndex((header) => patterns.some((pattern) => pattern.test(header)));
}

function looksLikeHeader(cells) {
  const text = cells.map(decodeFeedText).join(" | ");
  return /\bcompany\b/i.test(text) && /\b(?:role|title|position)\b/i.test(text);
}

function isDividerRow(cells) {
  return cells.length > 1 && cells.every((cell) => /^:?-{2,}:?$/.test(cell.trim()));
}

function inferredDate(cells) {
  for (const cell of [...cells].reverse()) {
    const text = decodeFeedText(cell);
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
    const short = text.match(/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{1,2})(?:,\s*(\d{4}))?$/i);
    if (short) {
      const year = short[3] ?? new Date().getUTCFullYear();
      return normalizePostingDate(`${short[1]} ${short[2]}, ${year}`);
    }
  }
  return "";
}

function seasonFor(seed, feed) {
  const evidence = `${seed.title}\n${seed.season ?? ""}\n${feed.season_hint ?? ""}`;
  if (/\b(?:intern|internship|co[-\s]?op|apprentice)\b/i.test(seed.title)) {
    if (/\b(?:spring|summer|fall|winter)\s+2027\b/i.test(evidence)) return evidence;
    return `${evidence}\n2027 internship cycle`;
  }
  return `${evidence}\n2027 new grad recruiting cycle`;
}

function degreeEligible(seed) {
  const education = normalize(seed.education);
  if (!education) return true;
  if (/\b(?:undergrad|undergraduate|bachelor'?s?|BS|B\.S\.)\b/i.test(education)) return true;
  return !/\b(?:master'?s?|MS|M\.S\.|Ph\.?D\.?|doctorate|doctoral)\b/i.test(education);
}

function normalizeSeed(seed, feed) {
  const title = normalizeRoleTitle(decodeFeedText(seed.title ?? seed.role));
  const company = normalizeCompanyName(decodeFeedText(seed.company));
  const location = decodeFeedText(seed.location);
  const url = humanApplyUrl(seed.url);
  const seasonHint = seasonFor({ ...seed, title }, feed);
  return {
    company,
    title,
    location,
    url,
    education: decodeFeedText(seed.education),
    season_hint: seasonHint,
    posted_at: normalizePostingDate(seed.posted_at ?? seed.date_added ?? "") || inferredDate(seed.cells ?? []),
    discovered_via: feed.homepage ?? feed.url,
    discovery_feed: feed.name,
    raw: normalize(seed.raw),
  };
}

export function humanApplyUrl(value) {
  return canonicalApplyUrl(value);
}

export function parseJsonFeed(feed, payload) {
  const rows = Array.isArray(payload) ? payload : (payload.jobs ?? payload.listings ?? payload.roles ?? []);
  return rows.map((row) => normalizeSeed({
    company: row.company ?? row.company_name,
    title: row.title ?? row.role ?? row.position,
    location: row.location ?? row.locations,
    education: row.education ?? row.degree ?? row.studentYears,
    season: row.season ?? row.cycle ?? row.type,
    url: row.url ?? row.apply_url ?? row.applyUrl ?? row.link,
    posted_at: row.posted_at ?? row.date_added ?? row.dateAdded ?? row.date,
    raw: JSON.stringify(row),
  }, feed));
}

export function parseMarkdownFeed(feed, markdown) {
  const seeds = [];
  let headers = [];
  let previousCompany = "";
  for (const line of markdown.split(/\r?\n/)) {
    if (!line.trim().startsWith("|")) continue;
    const cells = splitMarkdownRow(line);
    if (isDividerRow(cells)) continue;
    if (looksLikeHeader(cells)) {
      headers = cells.map(decodeFeedText);
      continue;
    }
    const url = applyUrlFromFeedRow(line);
    if (!url || cells.length < 3) continue;
    const companyIndex = headerIndex(headers, [/company/i], 0);
    const titleIndex = headerIndex(headers, [/role/i, /title/i, /position/i], 1);
    const locationIndex = headerIndex(headers, [/location/i, /office/i], 2);
    const educationIndex = headerIndex(headers, [/education/i, /degree/i, /student/i]);
    let company = decodeFeedText(cells[companyIndex] ?? cells[0]);
    if (/^(?:↳|same|")/i.test(company) || !company) company = previousCompany;
    if (company) previousCompany = company;
    seeds.push(normalizeSeed({
      company,
      title: cells[titleIndex] ?? cells[1],
      location: cells[locationIndex] ?? cells[2],
      education: educationIndex >= 0 ? cells[educationIndex] : "",
      url,
      cells,
      raw: line,
    }, feed));
  }
  return seeds;
}

export function discoverySeedRejection(seed) {
  if (!seed.company || !seed.title || !seed.url) return "missing required field";
  if (!isOfficialJobUrl(seed.url)) return "non-official application URL";
  if (/\b(?:closed|expired)\b|🔒/i.test(seed.raw)) return "marked closed by discovery source";
  if (!degreeEligible(seed)) return "graduate-degree-only role";
  if (!isRelevant(seed.title)) return "untracked discipline";
  const context = `${seed.location}\n${seed.education}\n${seed.season_hint}`;
  if (hasOnlyExcludedGraduationWindow(seed.title, context)) return "excluded recruiting year";
  if (!isEligibleRole(seed.title, context)) return "not a 2027 BS internship/new-grad role";
  return "";
}

function seedToLead(seed, verifiedJob = null, cachedRole = null) {
  const source = { company: seed.company, priority: "P1" };
  const parsed = verifiedJob && isRelevant(verifiedJob.title) ? verifiedJob : {
    title: seed.title,
    location: seed.location,
    description: seed.season_hint,
    url: seed.url,
  };
  const lead = htmlJobToLead(source, parsed);
  const context = `${parsed.description ?? ""}\n${seed.education}\n${seed.season_hint}`;
  lead.company = seed.company;
  lead.role_title = normalizeRoleTitle(parsed.title) || seed.title;
  lead.location = normalize(parsed.location) || seed.location;
  lead.direct_apply_url = seed.url;
  lead.career_source_url = seed.url;
  lead.posted_at = seed.posted_at || lead.posted_at;
  lead.graduation_match = roleType(seed.title, context) === "Internship"
    ? "2027 internship cycle"
    : "2027 new grad recruiting cycle";
  lead.season_hint = seed.season_hint;
  lead.discovered_via = seed.discovered_via;
  lead.discovery_feed = seed.discovery_feed;
  lead.verification_status = verifiedJob ? "official requisition verified" : "official verification cached";
  lead.verified_at = verifiedJob
    ? new Date().toISOString()
    : normalize(cachedRole?.verified_at) || new Date().toISOString();
  lead.source_id = `${normalizeCompanyName(seed.company).toLowerCase()}|discovery_feed`;
  lead.source_adapter = "discovery_feed";
  lead.verification_version = discoveryVerificationVersion;
  return lead;
}

function sourceHintFor(seed, sourceHints, adapter) {
  const company = normalizeCompanyName(seed.company).toLowerCase();
  return sourceHints.find((source) => source.adapter === adapter
    && normalizeCompanyName(source.company).toLowerCase() === company);
}

export function providerDescriptorForSeed(seed, sourceHints = []) {
  const url = new URL(seed.url);
  const segments = url.pathname.split("/").filter(Boolean);
  if (/^jobs\.ashbyhq\.com$/i.test(url.hostname) && segments.length >= 2) {
    return { adapter: "ashby", board: segments[0], id: segments[1] };
  }
  const greenhousePath = url.pathname.match(/^\/([^/]+)\/jobs\/(\d+)/i);
  if (/(?:boards|job-boards)(?:\.eu)?\.greenhouse\.io$/i.test(url.hostname) && greenhousePath) {
    return { adapter: "greenhouse", board: greenhousePath[1], id: greenhousePath[2] };
  }
  const greenhouseId = url.searchParams.get("gh_jid");
  const greenhouseHint = sourceHintFor(seed, sourceHints, "greenhouse");
  if (greenhouseId && greenhouseHint?.board) {
    return { adapter: "greenhouse", board: greenhouseHint.board, id: greenhouseId };
  }
  if (/^jobs\.lever\.co$/i.test(url.hostname) && segments.length >= 2) {
    return { adapter: "lever", board: segments[0], id: segments[1] };
  }
  const jobIndex = segments.findIndex((segment) => segment.toLowerCase() === "job");
  if (/\.myworkdayjobs\.com$/i.test(url.hostname) && jobIndex > 0) {
    return {
      adapter: "workday",
      host: url.hostname,
      tenant: url.hostname.split(".")[0],
      site: segments[jobIndex - 1],
      externalPath: `/${segments.slice(jobIndex).join("/")}`,
    };
  }
  return null;
}

function providerJobToHtmlShape(descriptor, job, seed) {
  if (descriptor.adapter === "ashby") {
    return {
      title: job.title,
      location: [job.location, ...(job.secondaryLocations ?? []).map((item) => item.location)].filter(Boolean).join("; "),
      description: job.descriptionPlain ?? job.descriptionHtml ?? "",
      url: job.jobUrl ?? seed.url,
      datePosted: job.publishedAt,
    };
  }
  if (descriptor.adapter === "greenhouse") {
    return {
      ...job,
      location: job.location?.name,
      description: job.content,
      url: job.absolute_url ?? seed.url,
      datePosted: job.updated_at,
    };
  }
  if (descriptor.adapter === "lever") {
    return {
      title: job.text,
      location: job.categories?.location,
      description: `${job.descriptionPlain ?? ""}\n${job.additionalPlain ?? ""}`,
      url: job.hostedUrl ?? seed.url,
      datePosted: job.createdAt,
    };
  }
  const info = job.jobPostingInfo ?? job;
  return {
    ...info,
    title: info.title,
    location: info.location,
    description: info.jobDescription,
    url: info.externalUrl ?? seed.url,
    datePosted: info.startDate,
    validThrough: info.endDate,
  };
}

async function verifyKnownProvider(seed, sourceHints, timeoutMs, cache) {
  const descriptor = providerDescriptorForSeed(seed, sourceHints);
  if (!descriptor) return null;
  try {
    let job;
    if (descriptor.adapter === "ashby") {
      const key = `ashby|${descriptor.board.toLowerCase()}`;
      if (!cache.has(key)) cache.set(key, fetchJson(`https://api.ashbyhq.com/posting-api/job-board/${descriptor.board}`, timeoutMs));
      const payload = await cache.get(key);
      job = (payload.jobs ?? payload.jobPostings ?? []).find((item) => item.id === descriptor.id
        || item.jobUrl?.includes(descriptor.id) || item.applyUrl?.includes(descriptor.id));
    } else if (descriptor.adapter === "greenhouse") {
      const key = `greenhouse|${descriptor.board.toLowerCase()}|${descriptor.id}`;
      if (!cache.has(key)) cache.set(key, fetchJson(`https://boards-api.greenhouse.io/v1/boards/${descriptor.board}/jobs/${descriptor.id}`, timeoutMs));
      job = await cache.get(key);
    } else if (descriptor.adapter === "lever") {
      const key = `lever|${descriptor.board.toLowerCase()}|${descriptor.id}`;
      if (!cache.has(key)) cache.set(key, fetchJson(`https://api.lever.co/v0/postings/${descriptor.board}/${descriptor.id}`, timeoutMs));
      job = await cache.get(key);
    } else if (descriptor.adapter === "workday") {
      const endpoint = `https://${descriptor.host}/wday/cxs/${descriptor.tenant}/${descriptor.site}${descriptor.externalPath}`;
      if (!cache.has(endpoint)) cache.set(endpoint, fetchJson(endpoint, timeoutMs));
      job = await cache.get(endpoint);
    }
    if (!job) throw new Error("provider requisition is no longer listed");
    return providerJobToHtmlShape(descriptor, job, seed);
  } catch (error) {
    if (/\b404\b|not found|no longer listed/i.test(error.message)) {
      throw new Error(`official posting closed: ${error.message}`);
    }
    return null;
  }
}

async function verifySeed(seed, timeoutMs, sourceHints, providerCache) {
  const providerJob = await verifyKnownProvider(seed, sourceHints, timeoutMs, providerCache);
  if (providerJob) return seedToLead(seed, providerJob);
  const document = await fetchDocument(seed.url, timeoutMs, { redirect: "follow" });
  const rejection = officialPageRejection(seed.url, document.url, document.text, seed.title);
  if (rejection) throw new Error(`official posting closed: ${rejection}`);
  const resolvedUrl = canonicalApplyUrl(document.url);
  if (!isOfficialJobUrl(resolvedUrl)) throw new Error("official link redirected to a non-job page");
  const job = htmlJobFromDetail({ company: seed.company }, resolvedUrl, document.text, {
    title: seed.title,
    location: seed.location,
    datePosted: seed.posted_at,
  });
  const officialContext = `${job.location}\n${job.description}\n${resolvedUrl.replace(/[-_/]+/g, " ")}`;
  if (hasOnlyExcludedGraduationWindow(job.title || seed.title, officialContext)) throw new Error("official page has an excluded recruiting year");
  const context = `${officialContext}\n${seed.education}\n${seed.season_hint}`;
  if (!isEligibleRole(seed.title, context)) throw new Error("official page does not confirm eligible role");
  const selectedTitle = isRelevant(job.title) ? normalizeRoleTitle(job.title) : seed.title;
  if (/\.\.\.$/.test(selectedTitle)) throw new Error("official page did not expose a complete title");
  return seedToLead(seed, job);
}

export async function scanDiscoveryFeeds(feeds, existingRoles = [], sourceHints = []) {
  validateDiscoveryFeeds(feeds);
  const fetched = await mapConcurrent(feeds, Math.min(discoveryFeedConcurrency, feeds.length || 1), async (feed) => {
    try {
      const seeds = feed.format === "json"
        ? parseJsonFeed(feed, await fetchJson(feed.url, discoveryFeedTimeoutMs))
        : parseMarkdownFeed(feed, await fetchText(feed.url, discoveryFeedTimeoutMs));
      return { feed, seeds, error: "" };
    } catch (error) {
      return { feed, seeds: [], error: error.message };
    }
  });

  const rejectionCounts = {};
  const candidatesByUrl = new Map();
  for (const result of fetched) {
    for (const seed of result.seeds) {
      const reason = discoverySeedRejection(seed);
      if (reason) {
        rejectionCounts[reason] = (rejectionCounts[reason] ?? 0) + 1;
        continue;
      }
      if (!candidatesByUrl.has(seed.url)) candidatesByUrl.set(seed.url, seed);
    }
  }

  const existingByKey = new Map(existingRoles.map((role) => [keyFor(role.company, role.title, role.location, role.url), role]));
  const leads = [];
  const verificationQueue = [];
  const reverifyAfterMs = discoveryFeedReverifyHours * 60 * 60 * 1000;
  const today = dateOnly(new Date().toISOString());
  for (const seed of candidatesByUrl.values()) {
    const key = keyFor(seed.company, seed.title, seed.location, seed.url);
    const existingRole = existingByKey.get(key);
    const lastVerifiedMs = Date.parse(existingRole?.verified_at || existingRole?.last_seen || "");
    const verificationFresh = Number(existingRole?.verification_version) === discoveryVerificationVersion
      && Number.isFinite(lastVerifiedMs)
      && Date.now() - lastVerifiedMs < reverifyAfterMs;
    const migrationFresh = Number(existingRole?.verification_version) === discoveryVerificationVersion
      && !existingRole?.verified_at
      && dateOnly(existingRole?.last_seen) === today;
    if (existingRole && (verificationFresh || migrationFresh)) {
      leads.push(seedToLead(seed, null, existingRole));
    } else {
      verificationQueue.push({ seed, existingRole });
    }
  }
  verificationQueue.sort((a, b) => Number(Boolean(b.existingRole)) - Number(Boolean(a.existingRole))
    || Date.parse(b.seed.posted_at || "0") - Date.parse(a.seed.posted_at || "0"));
  const attempted = verificationQueue.slice(0, discoveryFeedVerifyLimit);
  const deferred = verificationQueue.slice(discoveryFeedVerifyLimit);
  for (const item of deferred.filter((entry) => Number(entry.existingRole?.verification_version) === discoveryVerificationVersion)) {
    leads.push(seedToLead(item.seed, null, item.existingRole));
  }
  const providerCache = new Map();
  const verification = await mapConcurrent(attempted, discoveryFeedConcurrency, async ({ seed }) => {
    try {
      return { seed, lead: await verifySeed(seed, discoveryFeedTimeoutMs, sourceHints, providerCache), error: "" };
    } catch (error) {
      return { seed, lead: null, error: error.message };
    }
  });
  leads.push(...verification.map((item) => item.lead).filter(Boolean));
  for (const item of verification.filter((entry) => entry.error)) {
    const reason = `verification: ${item.error}`;
    rejectionCounts[reason] = (rejectionCounts[reason] ?? 0) + 1;
  }

  return {
    leads,
    confirmed_closed_urls: verification
      .filter((item) => /^official posting closed:/i.test(item.error))
      .map((item) => canonicalApplyUrl(item.seed.url)),
    scan_results: [...new Set([...candidatesByUrl.values()].map((seed) => normalizeCompanyName(seed.company)))].map((company) => ({
      source: { company, adapter: "discovery_feed", reconciliation: "partial" },
      leads: leads.filter((lead) => normalizeCompanyName(lead.company) === company),
      log: { company, adapter: "discovery_feed", source_kind: "secondary", status: "ok", phase: "feed-scan" },
    })),
    coverage: {
      feeds_configured: feeds.length,
      feeds_ok: fetched.filter((item) => !item.error).length,
      feeds_error: fetched.filter((item) => item.error).length,
      rows_parsed: fetched.reduce((sum, item) => sum + item.seeds.length, 0),
      official_candidates: candidatesByUrl.size,
      cached_verifications: leads.length - verification.filter((item) => item.lead).length,
      reverify_hours: discoveryFeedReverifyHours,
      verification_attempts: verification.length,
      verification_successes: verification.filter((item) => item.lead).length,
      verification_deferred: deferred.length,
      rejection_counts: rejectionCounts,
      errors: fetched.filter((item) => item.error).map((item) => ({ feed: item.feed.name, error: item.error })),
    },
  };
}
