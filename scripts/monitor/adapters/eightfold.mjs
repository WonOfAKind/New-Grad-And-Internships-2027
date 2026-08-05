import { fetchTimeoutMs, htmlDetailConcurrency, userAgent } from "../config.mjs";
import {
  hasOnlyExcludedGraduationWindow,
  isEligibleRole,
  isRelevant,
  mapConcurrent,
  normalize,
  normalizePostingDate,
  searchTextsFor,
} from "../domain.mjs";
import { fetchJson, fetchText } from "../http.mjs";
import { sourceForCompany } from "./context.mjs";
import { htmlJobFromDetail, htmlJobToLead } from "./html.mjs";

const defaultPageSize = 10;

function baseUrlFor(source) {
  return normalize(source.baseUrl).replace(/\/+$/, "");
}

export function eightfoldSearchUrl(source, searchText = "", start = 0) {
  const url = new URL("/api/pcsx/search", baseUrlFor(source));
  url.searchParams.set("domain", source.domain);
  url.searchParams.set("query", searchText);
  url.searchParams.set("location", source.location ?? "United States");
  url.searchParams.set("start", String(start));
  url.searchParams.set("sort_by", "recent");
  return url.toString();
}

export function eightfoldJobUrl(source, job) {
  const path = normalize(job.positionUrl) || `/careers/job/${normalize(job.id)}`;
  return new URL(path, `${baseUrlFor(source)}/`).toString().replace(/^http:/i, "https:");
}

export function eightfoldInternshipCycleEvidence(source, job) {
  const targetYear = Number(source.targetYear ?? 2027);
  const postedAt = normalizePostingDate(job.datePosted ?? job.posted_at ?? "");
  const expiresAt = normalizePostingDate(job.validThrough ?? job.expires_at ?? "");
  const title = normalize(job.title ?? job.name);
  const content = normalize(job.description);
  const universityInternship = /\bintern(?:ship)?\s+opportunities?\s+for\s+university\s+students?\b/i.test(title);
  const bachelorEligible = /\b(?:currently\s+pursuing\s+)?bachelor'?s?\s+degree\b/i.test(content);
  const priorYear = targetYear - 1;
  if (universityInternship
    && bachelorEligible
    && postedAt >= `${priorYear}-06-01`
    && postedAt < `${targetYear}-01-01`
    && expiresAt >= `${targetYear}-01-01`) {
    return `${targetYear} internship eligible`;
  }
  return "";
}

function enrichedEightfoldJob(source, job) {
  const cycleEvidence = eightfoldInternshipCycleEvidence(source, job);
  return cycleEvidence ? { ...job, description: `${job.description}\n${cycleEvidence}` } : job;
}

export async function fetchEightfoldJob(source, summary, timeoutMs = fetchTimeoutMs) {
  const url = eightfoldJobUrl(source, summary);
  const html = await fetchText(url, timeoutMs, {
    headers: {
      "User-Agent": userAgent,
      "Accept": "text/html,application/xhtml+xml,*/*",
      "Referer": `${baseUrlFor(source)}/careers`,
    },
  });
  const job = htmlJobFromDetail(
    { ...source, keepDetailQuery: false },
    url,
    html,
    {
      title: summary.name ?? summary.title,
      location: (summary.standardizedLocations ?? summary.locations ?? []).join("; "),
    },
  );
  if (!normalize(job.datePosted)) {
    job.datePosted = summary.postedTs
      ? new Date(Number(summary.postedTs) * 1000).toISOString()
      : summary.datePosted;
  }
  job.title = normalize(job.title).replace(/,\s*$/, "");
  job.url = url;
  return enrichedEightfoldJob(source, job);
}

async function fetchEightfoldSearchPages(source, searchText, timeoutMs) {
  const maxPages = source.maxPages ?? 10;
  const positions = [];
  for (let page = 0; page < maxPages; page += 1) {
    const start = page * defaultPageSize;
    const payload = await fetchJson(eightfoldSearchUrl(source, searchText, start), timeoutMs, {
      headers: {
        "User-Agent": userAgent,
        "Accept": "application/json",
        "Referer": `${baseUrlFor(source)}/careers`,
      },
    });
    const rows = Array.isArray(payload?.data?.positions) ? payload.data.positions : [];
    positions.push(...rows);
    const total = Number(payload?.data?.count);
    if (rows.length < defaultPageSize || (Number.isFinite(total) && start + rows.length >= total)) break;
  }
  return positions;
}

export async function scanEightfold(source, timeoutMs = fetchTimeoutMs) {
  const resultSets = await mapConcurrent(
    searchTextsFor(source),
    Math.min(source.searchConcurrency ?? 3, 6),
    async (searchText) => {
      try {
        return { positions: await fetchEightfoldSearchPages(source, searchText, timeoutMs), error: "" };
      } catch (error) {
        return { positions: [], error: error.message };
      }
    },
  );
  if (resultSets.every((result) => result.error)) {
    throw new Error(`${source.company} Eightfold searches failed: ${resultSets[0].error}`);
  }
  const positions = new Map();
  for (const position of resultSets.flatMap((result) => result.positions)) {
    const id = normalize(position.id ?? position.positionUrl);
    if (id) positions.set(id, position);
  }
  const candidates = [...positions.values()].filter((position) => {
    const title = normalize(position.name ?? position.title);
    const context = `${(position.standardizedLocations ?? position.locations ?? []).join("; ")}\n${position.department ?? ""}`;
    return isRelevant(title, context)
      && !hasOnlyExcludedGraduationWindow(title, context)
      && (/\b(?:intern|internship|co[-\s]?op)\b/i.test(title) || isEligibleRole(title, context));
  });
  const detailLimit = source.detailLimit ?? 100;
  const jobs = await mapConcurrent(candidates.slice(0, detailLimit), htmlDetailConcurrency, async (summary) => {
    try {
      return await fetchEightfoldJob(source, summary, timeoutMs);
    } catch {
      return null;
    }
  });
  if (candidates.length > 0 && jobs.every((job) => !job)) throw new Error(`${source.company} Eightfold detail pages were unavailable`);
  return jobs
    .filter(Boolean)
    .filter((job) => {
      const context = `${job.location}\n${job.description}`;
      return isRelevant(job.title, context)
        && isEligibleRole(job.title, context)
        && !hasOnlyExcludedGraduationWindow(job.title, context);
    })
    .map((job) => {
      const lead = htmlJobToLead(source, job);
      lead.career_source_url = sourceForCompany(source.company)?.career_url ?? `${baseUrlFor(source)}/careers`;
      return lead;
    });
}
