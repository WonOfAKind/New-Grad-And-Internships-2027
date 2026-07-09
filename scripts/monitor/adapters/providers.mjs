import {
  fetchTimeoutMs,
  htmlDetailConcurrency,
  teslaStateUrl,
} from "../config.mjs";
import {
  absoluteHttpUrl,
  categorize,
  chooseResume,
  extractCompensation,
  fitNotes,
  graduationMatch,
  hasOnlyExcludedGraduationWindow,
  isEligibleRole,
  isRelevant,
  mapConcurrent,
  normalize,
  priorityFor,
  searchTextsFor,
  tailoringNotes,
} from "../domain.mjs";
import { fetchJson, fetchText, fetchWithRetries } from "../http.mjs";
import { sourceForCompany } from "./context.mjs";

export function greenhouseJobToLead(source, job) {
  const title = normalize(job.title);
  const location = normalize(job.location?.name);
  const content = normalize(job.content);
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
    direct_apply_url: job.absolute_url,
    career_source_url: sourceForCompany(source.company)?.career_url ?? job.absolute_url,
    lead_status: "Tailor Resume",
    updated_at: job.updated_at ?? "",
    category,
    compensation: extractCompensation(title, content, job),
    graduation_match: gradMatch,
    jd_keywords: gradMatch === "2027 grad eligible" ? ["2027 graduation window"] : [],
    fit_notes: fitNotes(title, category),
    tailoring_notes: tailoringNotes(title, category, resumeChoice),
    apply_notes: "Review after resume upload; do not submit without user confirmation.",
  };
}

export function leverJobToLead(source, job) {
  const title = normalize(job.text);
  const location = normalize(job.categories?.location);
  const listContent = (job.lists ?? [])
    .map((list) => `${list.text ?? ""}\n${list.content ?? ""}`)
    .join("\n");
  const content = normalize(`${job.descriptionPlain ?? ""}
${job.descriptionBodyPlain ?? ""}
${job.openingPlain ?? ""}
${job.additionalPlain ?? ""}
${job.additional ?? ""}
${listContent}`);
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
    direct_apply_url: job.hostedUrl ?? job.applyUrl,
    career_source_url: sourceForCompany(source.company)?.career_url ?? job.hostedUrl ?? job.applyUrl,
    lead_status: "Tailor Resume",
    updated_at: job.createdAt ? new Date(job.createdAt).toISOString() : "",
    category,
    compensation: extractCompensation(title, content, job),
    graduation_match: gradMatch,
    jd_keywords: gradMatch === "2027 grad eligible" ? ["2027 graduation window"] : [],
    fit_notes: fitNotes(title, category),
    tailoring_notes: tailoringNotes(title, category, resumeChoice),
    apply_notes: "Review after resume upload; do not submit without user confirmation.",
  };
}

export function stripHtml(html = "") {
  return normalize(html.replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " "));
}

export function ashbyJobToLead(source, job) {
  const title = normalize(job.title);
  const secondaryLocations = (job.secondaryLocations ?? [])
    .map((item) => normalize(item.location))
    .filter(Boolean);
  const location = [normalize(job.location), ...secondaryLocations].filter(Boolean).join("; ");
  const content = stripHtml(job.descriptionHtml);
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
    direct_apply_url: job.jobUrl ?? job.applyUrl,
    career_source_url: sourceForCompany(source.company)?.career_url ?? job.jobUrl ?? job.applyUrl,
    lead_status: "Tailor Resume",
    updated_at: job.publishedAt ?? "",
    category,
    compensation: extractCompensation(title, content, job),
    graduation_match: gradMatch,
    jd_keywords: gradMatch === "2027 grad eligible" ? ["2027 graduation window"] : [],
    fit_notes: fitNotes(title, category),
    tailoring_notes: tailoringNotes(title, category, resumeChoice),
    apply_notes: "Review after resume upload; do not submit without user confirmation.",
  };
}

export function workdayJobToLead(source, job) {
  const info = job.jobPostingInfo && typeof job.jobPostingInfo === "object" ? job.jobPostingInfo : {};
  const title = normalize(info.title ?? job.title);
  const additionalLocations = Array.isArray(info.additionalLocations)
    ? info.additionalLocations.map((item) => normalize(item?.location ?? item)).filter(Boolean)
    : [];
  const location = [normalize(info.location ?? job.locationsText), ...additionalLocations].filter(Boolean).join("; ");
  const description = stripHtml(info.jobDescription ?? job.jobDescription ?? "");
  const content = normalize(`${title}\n${info.timeType ?? job.timeType ?? ""}\n${location}\n${description}\n${(job.bulletFields ?? []).join("\n")}`);
  const category = categorize(title, content);
  const resumeChoice = chooseResume(title, content);
  const gradMatch = graduationMatch(title, content);
  const host = source.host ?? `${source.tenant}.wd1.myworkdayjobs.com`;
  const url = `https://${host}/${source.site}${job.externalPath}`;
  return {
    detected_date: new Date().toISOString().slice(0, 10),
    company: source.company,
    role_title: title,
    location,
    resume_choice: resumeChoice,
    priority: priorityFor(title, source.priority),
    direct_apply_url: url,
    career_source_url: sourceForCompany(source.company)?.career_url ?? url,
    lead_status: "Tailor Resume",
    updated_at: info.postedOn ?? info.startDate ?? job.postedOn ?? "",
    category,
    compensation: extractCompensation(title, content, job),
    graduation_match: gradMatch,
    jd_keywords: gradMatch === "2027 grad eligible" ? ["2027 graduation window"] : [],
    fit_notes: fitNotes(title, category),
    tailoring_notes: tailoringNotes(title, category, resumeChoice),
    apply_notes: "Review after resume upload; do not submit without user confirmation.",
  };
}

export function phenomJobToLead(source, job) {
  const title = normalize(job.title);
  const location = normalize(job.location ?? job.cityStateCountry ?? job.cityState);
  const content = normalize(`${job.descriptionTeaser ?? ""}\n${job.type ?? ""}\n${job.experienceLevel ?? ""}\n${job.category ?? ""}`);
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
    direct_apply_url: absoluteHttpUrl(source.baseUrl, job.applyUrl ?? job.url) || sourceForCompany(source.company)?.career_url,
    career_source_url: sourceForCompany(source.company)?.career_url ?? absoluteHttpUrl(source.baseUrl, job.applyUrl ?? job.url),
    lead_status: "Tailor Resume",
    updated_at: job.postedDate ?? job.dateCreated ?? "",
    category,
    compensation: extractCompensation(title, content, job),
    graduation_match: gradMatch,
    jd_keywords: gradMatch === "2027 grad eligible" ? ["2027 graduation window"] : [],
    fit_notes: fitNotes(title, category),
    tailoring_notes: tailoringNotes(title, category, resumeChoice),
    apply_notes: "Review after resume upload; do not submit without user confirmation.",
  };
}

export function avatureJobToLead(source, job) {
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
    direct_apply_url: absoluteHttpUrl(source.baseUrl, job.url),
    career_source_url: sourceForCompany(source.company)?.career_url ?? absoluteHttpUrl(source.baseUrl, job.url),
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
export function teslaTypeLabel(value) {
  const labels = {
    fulltime: "Full-Time",
    parttime: "Part-Time",
    intern: "Intern/Apprentice",
    seasonal: "Seasonal",
  };
  const key = normalize(value).toLowerCase();
  return labels[key] ?? normalize(value).replace(/[_-]+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

export function teslaSlug(title, jobId) {
  const slug = normalize(title).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "job";
  return `https://www.tesla.com/careers/search/job/${slug}-${jobId}`;
}

export function teslaStringLookup(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [String(key), normalize(item)]));
}

export function teslaIdSet(value) {
  if (value == null) return new Set();
  if (Array.isArray(value)) return new Set(value.map((item) => normalize(item)).filter(Boolean));
  const id = normalize(value);
  return id ? new Set([id]) : new Set();
}

export function collectTeslaLocationIds(node, ids) {
  const cities = node?.cities;
  if (cities && typeof cities === "object") {
    for (const values of Object.values(cities)) {
      for (const id of teslaIdSet(values)) ids.add(id);
    }
  }
  for (const state of node?.states ?? []) {
    if (state && typeof state === "object") collectTeslaLocationIds(state, ids);
  }
}

export function teslaLocationIdsForSite(payload, site = "US") {
  const ids = new Set();
  const wanted = site.toLowerCase();
  for (const region of payload.geo ?? []) {
    if (!region || typeof region !== "object") continue;
    for (const siteNode of region.sites ?? []) {
      if (!siteNode || typeof siteNode !== "object") continue;
      if (normalize(siteNode.id).toLowerCase() !== wanted) continue;
      collectTeslaLocationIds(siteNode, ids);
    }
  }
  return ids;
}

export function teslaListingToLead(source, row, lookups) {
  const title = normalize(row.t);
  const jobId = normalize(row.id);
  const locationId = [...teslaIdSet(row.l)][0] ?? "";
  if (!title || !jobId) return null;
  const department = normalize(lookups.departments[String(row.dp)]);
  const location = normalize(lookups.locations[locationId]);
  const jobType = teslaTypeLabel(lookups.types[String(row.y)]);
  const content = normalize(`${department}\n${jobType}\n${location}`);
  const category = categorize(title, content);
  const resumeChoice = chooseResume(title, content);
  const gradMatch = graduationMatch(title, content);
  const url = teslaSlug(title, jobId);
  return {
    detected_date: new Date().toISOString().slice(0, 10),
    company: source.company,
    role_title: title,
    location,
    resume_choice: resumeChoice,
    priority: priorityFor(title, source.priority),
    direct_apply_url: url,
    career_source_url: sourceForCompany(source.company)?.career_url ?? source.url ?? teslaStateUrl,
    lead_status: "Tailor Resume",
    updated_at: "",
    category,
    compensation: extractCompensation(title, content, row),
    graduation_match: gradMatch,
    jd_keywords: gradMatch === "2027 grad eligible" ? ["2027 graduation window"] : [],
    fit_notes: fitNotes(title, category),
    tailoring_notes: tailoringNotes(title, category, resumeChoice),
    apply_notes: "Review after resume upload; do not submit without user confirmation.",
  };
}

export async function scanTesla(source, timeoutMs = fetchTimeoutMs) {
  const url = source.url ?? teslaStateUrl;
  const payload = await fetchJson(url, timeoutMs);
  if (!payload || typeof payload !== "object" || !Array.isArray(payload.listings)) {
    throw new Error("Tesla careers state endpoint returned an unexpected payload shape");
  }
  const lookup = payload.lookup && typeof payload.lookup === "object" ? payload.lookup : {};
  const lookups = {
    departments: teslaStringLookup(lookup.departments),
    locations: teslaStringLookup(lookup.locations),
    types: teslaStringLookup(lookup.types),
  };
  const locationIds = teslaLocationIdsForSite(payload, source.site ?? "US");
  if (locationIds.size === 0) {
    throw new Error(`Tesla careers state payload did not include location ids for site=${source.site ?? "US"}`);
  }

  const leads = [];
  for (const row of payload.listings) {
    if (!row || typeof row !== "object") continue;
    const rowLocationIds = teslaIdSet(row.l);
    if (![...rowLocationIds].some((id) => locationIds.has(id))) continue;
    const lead = teslaListingToLead(source, row, lookups);
    if (!lead) continue;
    if (!isRelevant(lead.role_title, `${lead.category}\n${lead.location}`)) continue;
    if (hasOnlyExcludedGraduationWindow(lead.role_title, `${lead.category}\n${lead.location}`)) continue;
    leads.push(lead);
  }
  return leads;
}

export async function scanGreenhouse(source, timeoutMs = fetchTimeoutMs) {
  const url = `https://boards-api.greenhouse.io/v1/boards/${source.board}/jobs?content=true`;
  const data = await fetchJson(url, timeoutMs);
  return (data.jobs ?? [])
    .filter((job) => isRelevant(job.title) && !hasOnlyExcludedGraduationWindow(job.title, job.content))
    .map((job) => greenhouseJobToLead(source, job));
}

export async function scanLever(source, timeoutMs = fetchTimeoutMs) {
  const url = `https://api.lever.co/v0/postings/${source.site}?mode=json`;
  const jobs = await fetchJson(url, timeoutMs);
  return jobs
    .filter((job) => isRelevant(job.text) && !hasOnlyExcludedGraduationWindow(job.text, job.descriptionPlain))
    .map((job) => leverJobToLead(source, job));
}

export async function scanAshby(source, timeoutMs = fetchTimeoutMs) {
  const url = `https://api.ashbyhq.com/posting-api/job-board/${source.board}`;
  const data = await fetchJson(url, timeoutMs);
  return (data.jobs ?? data.jobPostings ?? [])
    .filter((job) => isRelevant(job.title) && !hasOnlyExcludedGraduationWindow(job.title, stripHtml(job.descriptionHtml)))
    .map((job) => ashbyJobToLead(source, job));
}

export async function scanWorkday(source, timeoutMs = fetchTimeoutMs) {
  const host = source.host ?? `${source.tenant}.wd1.myworkdayjobs.com`;
  const url = `https://${host}/wday/cxs/${source.tenant}/${source.site}/jobs`;
  const limit = Math.min(source.limit ?? 20, 20);
  const maxPages = source.maxPages ?? 3;
  const jobsByPath = new Map();

  for (const searchText of searchTextsFor(source)) {
    for (let page = 0; page < maxPages; page += 1) {
      const offset = page * limit;
      const data = await fetchWithRetries(url, "application/json,text/plain,*/*", (response) => response.json(), timeoutMs, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit, offset, searchText }),
      });
      const postings = Array.isArray(data.jobPostings) ? data.jobPostings : [];
      for (const job of postings) {
        if (job.externalPath) jobsByPath.set(job.externalPath, job);
      }
      const total = Number(data.total);
      if (postings.length < limit || (Number.isFinite(total) && offset + postings.length >= total)) break;
    }
  }

  const candidates = [...jobsByPath.values()].filter((job) => {
    const context = `${job.timeType ?? ""}\n${job.locationsText ?? ""}\n${(job.bulletFields ?? []).join("\n")}`;
    return isRelevant(job.title)
      && isEligibleRole(job.title, context)
      && !hasOnlyExcludedGraduationWindow(job.title, context);
  });
  const detailLimit = source.detailLimit ?? 100;
  const detailBase = `https://${host}/wday/cxs/${source.tenant}/${source.site}`;
  const enriched = await mapConcurrent(candidates.slice(0, detailLimit), htmlDetailConcurrency, async (job) => {
    try {
      const detail = await fetchJson(`${detailBase}${job.externalPath}`, timeoutMs);
      return { ...job, ...detail };
    } catch {
      return job;
    }
  });
  return enriched.map((job) => workdayJobToLead(source, job));
}

export async function scanPhenom(source, timeoutMs = fetchTimeoutMs) {
  const url = source.widgetsUrl ?? `${source.baseUrl}/widgets`;
  const jobsByKey = new Map();
  for (const searchText of searchTextsFor(source)) {
    const data = await fetchWithRetries(url, "application/json,text/plain,*/*", (response) => response.json(), timeoutMs, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Origin": source.baseUrl,
        "Referer": source.referer ?? `${source.baseUrl}/global/en/search-results`,
      },
      body: JSON.stringify({
        ddoKey: "refineSearch",
        sortBy: "",
        subsearch: "",
        from: 0,
        jobs: true,
        counts: true,
        all_fields: source.allFields ?? ["category", "country", "state", "city", "type"],
        size: source.limit ?? 50,
        clearAll: false,
        jdsource: "facets",
        isSliderEnable: false,
        pageName: source.pageName ?? "search-results",
        siteType: "external",
        keywords: searchText,
        global: true,
        selected_fields: source.selectedFields ?? {},
      }),
    });
    for (const job of data.refineSearch?.data?.jobs ?? []) {
      const key = normalize(job.jobId ?? job.reqId ?? job.applyUrl ?? job.url) || `${normalize(job.title)}|${normalize(job.location)}`;
      jobsByKey.set(key, job);
    }
  }
  return [...jobsByKey.values()]
    .filter((job) => isRelevant(job.title) && !hasOnlyExcludedGraduationWindow(job.title, `${job.descriptionTeaser ?? ""}\n${job.type ?? ""}\n${job.experienceLevel ?? ""}\n${job.category ?? ""}`))
    .map((job) => phenomJobToLead(source, job));
}

export async function scanAvature(source, timeoutMs = fetchTimeoutMs) {
  const limit = source.limit ?? 20;
  const jobsByUrl = new Map();
  for (const searchText of searchTextsFor(source)) {
    const query = encodeURIComponent(searchText);
    const url = `${source.baseUrl}/careers/SearchJobs/?jobRecordsPerPage=${limit}&jobOffset=0&jobSearch=${query}`;
    const html = await fetchText(url, timeoutMs, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Accept": "text/html,*/*",
      },
    });
    const cards = [...html.matchAll(/<article[\s\S]*?<\/article>/gi)].map((match) => match[0]);
    for (const card of cards) {
      const titleMatch = card.match(/<a\b[^>]*class=["'][^"']*\blink\b[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>\s*([\s\S]*?)\s*<\/a>/i)
        ?? card.match(/<a\b[^>]*href=["']([^"']+)["'][^>]*class=["'][^"']*\blink\b[^"']*["'][^>]*>\s*([\s\S]*?)\s*<\/a>/i);
      const locationMatch = card.match(/<span\b[^>]*class=["'][^"']*list-item-location[^"']*["'][^>]*>([\s\S]*?)<\/span>/i);
      const job = {
        url: absoluteHttpUrl(source.baseUrl, titleMatch?.[1]),
        title: stripHtml(titleMatch?.[2] ?? ""),
        location: stripHtml(locationMatch?.[1] ?? ""),
      };
      if (job.url) jobsByUrl.set(job.url, job);
    }
  }
  const candidates = [...jobsByUrl.values()]
    .filter((job) => isRelevant(job.title) && isEligibleRole(job.title, job.location) && !hasOnlyExcludedGraduationWindow(job.title, job.location));
  const detailLimit = source.detailLimit ?? 100;
  const enriched = await mapConcurrent(candidates.slice(0, detailLimit), htmlDetailConcurrency, async (job) => {
    try {
      const html = await fetchText(job.url, timeoutMs, { headers: { "User-Agent": "Mozilla/5.0", "Accept": "text/html,*/*" } });
      return { ...job, description: stripHtml(html) };
    } catch {
      return job;
    }
  });
  return enriched.map((job) => avatureJobToLead(source, job));
}

