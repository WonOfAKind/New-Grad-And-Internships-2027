import { fetchTimeoutMs, htmlDetailConcurrency } from "../config.mjs";
import {
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

const searchExpand = "requisitionList.workLocation,requisitionList.otherWorkLocations,requisitionList.secondaryLocations,flexFieldsFacet.values,requisitionList.requisitionFlexFields";

function stripHtml(value = "") {
  return normalize(String(value)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&"));
}

function oracleBaseUrl(source) {
  return normalize(source.baseUrl).replace(/\/+$/, "");
}

function oracleFinderValue(source, searchText, limit, offset) {
  const values = [
    `siteNumber=${encodeURIComponent(source.siteNumber)}`,
    `limit=${limit}`,
    `offset=${offset}`,
    "sortBy=POSTING_DATES_DESC",
  ];
  if (searchText) values.push(`keyword=\"${encodeURIComponent(searchText)}\"`);
  return `findReqs;${values.join(",")}`;
}

export function oracleSearchUrl(source, searchText = "", limit = 100, offset = 0) {
  return `${oracleBaseUrl(source)}/hcmRestApi/resources/latest/recruitingCEJobRequisitions`
    + `?onlyData=true&expand=${searchExpand}&finder=${oracleFinderValue(source, searchText, limit, offset)}`;
}

export function oracleJobUrl(source, id) {
  const language = source.language ?? "en";
  return `${oracleBaseUrl(source)}/hcmUI/CandidateExperience/${language}/sites/${source.siteNumber}/job/${id}`;
}

export function oracleDetailUrl(source, id) {
  return `${oracleBaseUrl(source)}/hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails`
    + `?expand=all&onlyData=true&finder=ById;Id=\"${encodeURIComponent(id)}\",siteNumber=${encodeURIComponent(source.siteNumber)}`;
}

export async function fetchOracleJobDetail(source, id, timeoutMs = fetchTimeoutMs) {
  const payload = await fetchJson(oracleDetailUrl(source, id), timeoutMs);
  const job = payload?.items?.[0];
  if (!job) throw new Error("Oracle requisition is no longer listed");
  return job;
}

function oracleLocation(job) {
  const secondary = (job.secondaryLocations ?? [])
    .map((item) => normalize(item?.Name ?? item?.name ?? item?.Location ?? item))
    .filter(Boolean);
  return [...new Set([normalize(job.PrimaryLocation), ...secondary].filter(Boolean))].join("; ");
}

export function oracleJobContent(job) {
  return normalize([
    job.Category,
    job.RequisitionType,
    job.JobSchedule,
    job.StudyLevel,
    stripHtml(job.ExternalDescriptionStr ?? job.ShortDescriptionStr ?? ""),
    stripHtml(job.ExternalResponsibilitiesStr ?? job.InternalResponsibilitiesStr ?? ""),
    stripHtml(job.ExternalQualificationsStr ?? job.InternalQualificationsStr ?? ""),
  ].filter(Boolean).join("\n"));
}

export function oracleJobToHtmlShape(source, job) {
  const id = normalize(job.Id ?? job.id);
  return {
    title: normalize(job.Title ?? job.title),
    location: oracleLocation(job),
    description: oracleJobContent(job),
    url: oracleJobUrl(source, id),
    datePosted: job.ExternalPostedStartDate ?? job.PostedDate,
    validThrough: job.ExternalPostedEndDate,
  };
}

export function oracleJobToLead(source, job) {
  const title = normalize(job.Title ?? job.title);
  const location = oracleLocation(job);
  const content = oracleJobContent(job);
  const category = categorize(title, content);
  const resumeChoice = chooseResume(title, content);
  const gradMatch = graduationMatch(title, content);
  const url = oracleJobUrl(source, job.Id ?? job.id);
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
    posted_at: normalizePostingDate(job.ExternalPostedStartDate ?? job.PostedDate ?? ""),
    expires_at: normalizePostingDate(job.ExternalPostedEndDate ?? ""),
    updated_at: job.ExternalPostedStartDate ?? job.PostedDate ?? "",
    category,
    compensation: extractCompensation(title, content, job),
    graduation_match: gradMatch,
    jd_keywords: gradMatch === "2027 grad eligible" ? ["2027 graduation window"] : [],
    fit_notes: fitNotes(title, category),
    tailoring_notes: tailoringNotes(title, category, resumeChoice),
    apply_notes: "Review after resume upload; do not submit without user confirmation.",
  };
}

export async function scanOracle(source, timeoutMs = fetchTimeoutMs) {
  const limit = Math.min(source.limit ?? 100, 100);
  const maxPages = source.maxPages ?? 3;
  const summaries = new Map();

  for (const searchText of searchTextsFor(source)) {
    for (let page = 0; page < maxPages; page += 1) {
      const offset = page * limit;
      const payload = await fetchJson(oracleSearchUrl(source, searchText, limit, offset), timeoutMs);
      const result = payload?.items?.[0];
      const rows = result?.requisitionList ?? [];
      for (const job of rows) {
        const id = normalize(job.Id ?? job.id);
        if (id) summaries.set(id, job);
      }
      const total = Number(result?.TotalJobsCount ?? result?.totalJobsCount);
      if (rows.length < limit || (Number.isFinite(total) && offset + rows.length >= total)) break;
    }
  }

  const candidates = [...summaries.values()].filter((job) => {
    const title = normalize(job.Title ?? job.title);
    const context = `${job.Category ?? ""}\n${job.RequisitionType ?? ""}\n${job.PrimaryLocation ?? ""}`;
    return isRelevant(title, context)
      && isEligibleRole(title, context)
      && !hasOnlyExcludedGraduationWindow(title, context);
  });
  const detailLimit = source.detailLimit ?? 200;
  const detailed = await mapConcurrent(candidates.slice(0, detailLimit), htmlDetailConcurrency, async (summary) => {
    try {
      return await fetchOracleJobDetail(source, summary.Id ?? summary.id, timeoutMs);
    } catch {
      return summary;
    }
  });
  return detailed
    .filter((job) => {
      const title = normalize(job.Title ?? job.title);
      const context = `${oracleLocation(job)}\n${oracleJobContent(job)}`;
      return isRelevant(title, context)
        && isEligibleRole(title, context)
        && !hasOnlyExcludedGraduationWindow(title, context);
    })
    .map((job) => oracleJobToLead(source, job));
}
