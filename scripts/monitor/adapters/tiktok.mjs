import { fetchTimeoutMs } from "../config.mjs";
import {
  categorize,
  chooseResume,
  extractCompensation,
  fitNotes,
  graduationMatch,
  hasOnlyExcludedGraduationWindow,
  isEligibleRole,
  isRelevant,
  normalize,
  normalizePostingDate,
  priorityFor,
  searchTextsFor,
  tailoringNotes,
} from "../domain.mjs";
import { fetchWithRetries } from "../http.mjs";
import { sourceForCompany } from "./context.mjs";

const defaultApiBase = "https://api.lifeattiktok.com/api/v1/public/supplier";

function apiBase(source) {
  return normalize(source.baseUrl || defaultApiBase).replace(/\/+$/, "");
}

function apiHeaders() {
  return {
    "Content-Type": "application/json",
    "Accept-Language": "en-US",
    "Origin": "https://lifeattiktok.com",
    "website-path": "tiktok",
  };
}

function rootLocation(node) {
  let current = node;
  while (current?.parent) current = current.parent;
  return current;
}

export function isUnitedStatesTikTokJob(job) {
  const root = rootLocation(job?.city_info);
  return root?.code === "CN_6" || /United States/i.test(normalize(root?.en_name ?? root?.i18n_name));
}

export function tiktokLocation(job) {
  const values = [];
  let current = job?.city_info;
  while (current) {
    const name = normalize(current.en_name ?? current.i18n_name ?? current.name);
    if (name && !values.includes(name)) values.push(name);
    current = current.parent;
  }
  return values.join(", ");
}

function tiktokStructuredSalary(job) {
  const info = job?.job_post_info ?? {};
  if (info.min_salary == null && info.max_salary == null) return {};
  const internship = /\b(?:intern|internship|co[-\s]?op)\b/i.test(job.title ?? "");
  return {
    baseSalary: {
      currency: info.currency || "USD",
      value: {
        minValue: info.min_salary,
        maxValue: info.max_salary,
        unitText: internship ? "HOUR" : "YEAR",
      },
    },
  };
}

function tiktokExpiry(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return normalizePostingDate(value ?? "");
  const millis = numeric < 10_000_000_000 ? numeric * 1000 : numeric;
  return new Date(millis).toISOString().slice(0, 10);
}

export function tiktokJobToLead(source, job) {
  const title = normalize(job.title);
  const location = tiktokLocation(job);
  const content = normalize([
    job.description,
    job.requirement,
    job.job_category?.en_name,
    job.job_subject?.en_name,
    job.recruit_type?.en_name,
  ].filter(Boolean).join("\n"));
  const category = categorize(title, content);
  const resumeChoice = chooseResume(title, content);
  const gradMatch = graduationMatch(title, content);
  const url = `https://lifeattiktok.com/search/${job.id}`;
  return {
    detected_date: new Date().toISOString().slice(0, 10),
    company: source.company,
    role_title: title,
    location,
    resume_choice: resumeChoice,
    priority: priorityFor(title, source.priority),
    direct_apply_url: url,
    career_source_url: sourceForCompany(source.company)?.career_url ?? "https://lifeattiktok.com/search",
    lead_status: "Tailor Resume",
    posted_at: normalizePostingDate(job.job_post_info?.publish_time ?? job.publish_time ?? ""),
    expires_at: tiktokExpiry(job.job_post_info?.expiry_time),
    updated_at: "",
    category,
    compensation: extractCompensation(title, content, tiktokStructuredSalary(job), job),
    graduation_match: gradMatch,
    jd_keywords: gradMatch === "2027 grad eligible" ? ["2027 graduation window"] : [],
    fit_notes: fitNotes(title, category),
    tailoring_notes: tailoringNotes(title, category, resumeChoice),
    apply_notes: "Review after resume upload; do not submit without user confirmation.",
  };
}

export async function scanTikTok(source, timeoutMs = fetchTimeoutMs) {
  const endpoint = `${apiBase(source)}/search/job/posts`;
  const limit = Math.min(source.limit ?? 100, 100);
  const maxPages = source.maxPages ?? 10;
  const recruitmentTypes = source.recruitmentTypes ?? ["201", "202", "301"];
  const jobs = new Map();

  for (const searchText of searchTextsFor(source)) {
    for (let page = 0; page < maxPages; page += 1) {
      const offset = page * limit;
      const payload = await fetchWithRetries(
        endpoint,
        "application/json,text/plain,*/*",
        (response) => response.json(),
        timeoutMs,
        {
          method: "POST",
          headers: apiHeaders(),
          body: JSON.stringify({
            keyword: searchText,
            limit,
            offset,
            recruitment_id_list: recruitmentTypes,
          }),
        },
      );
      if (payload?.code !== 0 || !Array.isArray(payload?.data?.job_post_list)) {
        throw new Error(payload?.message || "TikTok careers API returned an unexpected payload shape");
      }
      const rows = payload.data.job_post_list;
      for (const job of rows) if (job?.id) jobs.set(String(job.id), job);
      const count = Number(payload.data.count);
      if (rows.length < limit || (Number.isFinite(count) && offset + rows.length >= count)) break;
    }
  }

  return [...jobs.values()]
    .filter(isUnitedStatesTikTokJob)
    .filter((job) => {
      const context = `${tiktokLocation(job)}\n${job.description ?? ""}\n${job.requirement ?? ""}`;
      return isRelevant(job.title, context)
        && isEligibleRole(job.title, context)
        && !hasOnlyExcludedGraduationWindow(job.title, context);
    })
    .map((job) => tiktokJobToLead(source, job));
}
