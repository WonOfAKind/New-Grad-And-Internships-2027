import { fetchTimeoutMs } from "../config.mjs";
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
  normalizePostingDate,
  priorityFor,
  searchTextsFor,
  tailoringNotes,
} from "../domain.mjs";
import { fetchJson } from "../http.mjs";
import { sourceForCompany } from "./context.mjs";

const defaultBaseUrl = "https://www.amazon.jobs";

function baseUrlFor(source) {
  return normalize(source.baseUrl || defaultBaseUrl).replace(/\/+$/, "");
}

export function amazonSearchUrl(source, searchText = "", limit = 100, offset = 0) {
  const url = new URL("/en/search.json", baseUrlFor(source));
  url.searchParams.set("base_query", searchText);
  url.searchParams.set("result_limit", String(limit));
  url.searchParams.set("sort", "recent");
  url.searchParams.set("offset", String(offset));
  return url.toString();
}

export function amazonJobContent(job) {
  return normalize([
    job.description,
    `Basic qualifications:\n${job.basic_qualifications ?? ""}`,
    `Preferred qualifications:\n${job.preferred_qualifications ?? ""}`,
    job.description_short,
    job.job_category,
    job.job_family,
    job.job_schedule_type,
    job.university_job ? "University job" : "",
  ].filter(Boolean).join("\n"));
}

export function isUnitedStatesAmazonJob(job) {
  const country = normalize(job.country_code);
  if (country) return /^(?:US|USA)$/i.test(country);
  return /\b(?:United States(?: of America)?|US|USA)\b/i.test(normalize(`${job.location ?? ""}\n${job.normalized_location ?? ""}`));
}

export function amazonJobUrl(source, job) {
  const path = normalize(job.job_path);
  if (path) return absoluteHttpUrl(`${baseUrlFor(source)}/`, path);
  const id = normalize(job.id_icims ?? job.id);
  return id ? `${baseUrlFor(source)}/en/jobs/${encodeURIComponent(id)}` : "";
}

export function amazonJobToLead(source, job) {
  const title = normalize(job.title);
  const location = normalize(job.location || job.normalized_location);
  const content = amazonJobContent(job);
  const category = categorize(title, content);
  const resumeChoice = chooseResume(title, content);
  const gradMatch = graduationMatch(title, content);
  const url = amazonJobUrl(source, job);
  return {
    detected_date: new Date().toISOString().slice(0, 10),
    company: source.company,
    role_title: title,
    location,
    resume_choice: resumeChoice,
    priority: priorityFor(title, source.priority),
    direct_apply_url: url,
    career_source_url: sourceForCompany(source.company)?.career_url ?? `${baseUrlFor(source)}/en/search`,
    lead_status: "Tailor Resume",
    posted_at: normalizePostingDate(job.posted_date ?? ""),
    expires_at: "",
    updated_at: normalize(job.updated_time),
    category,
    compensation: extractCompensation(title, content, job),
    graduation_match: gradMatch,
    jd_keywords: gradMatch === "2027 grad eligible" ? ["2027 graduation window"] : [],
    fit_notes: fitNotes(title, category),
    tailoring_notes: tailoringNotes(title, category, resumeChoice),
    apply_notes: "Review after resume upload; do not submit without user confirmation.",
  };
}

export function amazonJobToHtmlShape(source, job) {
  return {
    title: normalize(job.title),
    location: normalize(job.location || job.normalized_location),
    description: amazonJobContent(job),
    url: amazonJobUrl(source, job),
    datePosted: job.posted_date,
  };
}

async function fetchAmazonSearchPages(source, searchText, timeoutMs) {
  const limit = Math.min(source.limit ?? 100, 100);
  const maxPages = source.maxPages ?? 3;
  const jobs = [];
  for (let page = 0; page < maxPages; page += 1) {
    const offset = page * limit;
    const payload = await fetchJson(amazonSearchUrl(source, searchText, limit, offset), timeoutMs);
    const rows = Array.isArray(payload?.jobs) ? payload.jobs : [];
    jobs.push(...rows);
    const total = Number(payload?.hits);
    if (rows.length < limit || (Number.isFinite(total) && offset + rows.length >= total)) break;
  }
  return jobs;
}

export async function scanAmazon(source, timeoutMs = fetchTimeoutMs) {
  const resultSets = await mapConcurrent(
    searchTextsFor(source),
    Math.min(source.searchConcurrency ?? 4, 8),
    (searchText) => fetchAmazonSearchPages(source, searchText, timeoutMs),
  );
  const jobs = new Map();
  for (const job of resultSets.flat()) {
    const id = normalize(job.id_icims ?? job.id ?? job.job_path);
    if (id) jobs.set(id, job);
  }
  const matching = [...jobs.values()]
    .filter(isUnitedStatesAmazonJob)
    .filter((job) => {
      const content = amazonJobContent(job);
      return isRelevant(job.title, content)
        && isEligibleRole(job.title, content)
        && !hasOnlyExcludedGraduationWindow(job.title, content);
    });
  const latestByRole = new Map();
  for (const job of matching) {
    const key = `${normalize(job.title).toLowerCase()}|${normalize(job.location || job.normalized_location).toLowerCase()}`;
    const existing = latestByRole.get(key);
    if (!existing || Date.parse(job.posted_date || "0") > Date.parse(existing.posted_date || "0")) latestByRole.set(key, job);
  }
  return [...latestByRole.values()].map((job) => amazonJobToLead(source, job));
}
