import {
  closureCheckConcurrency,
  closureCheckTimeoutMs,
  userAgent,
} from "./config.mjs";
import {
  applyUrl,
  isAllowedLocation,
  isExpiredDate,
  isFreshEnough,
  keyFor,
  mapConcurrent,
  normalize,
  roleTitle,
} from "./domain.mjs";

import {
  closedPageReason,
  officialPageRejection,
} from "./official_page.mjs";

export { closedPageReason } from "./official_page.mjs";

// These adapters enumerate a company's complete official job collection. If a
// successful scan omits a cached role, the posting is either gone or no longer
// passes the board policy and must not be retained merely because its page is
// still live.
const authoritativeAdapters = new Set(["greenhouse", "lever", "ashby", "tesla", "rss_jobs"]);
export function sourceIdFor(source) {
  return `${normalize(source.company).toLowerCase()}|${normalize(source.adapter).toLowerCase()}`;
}

export function reconciliationModeFor(source) {
  if (source.reconciliation === "authoritative" || source.reconciliation === "partial") return source.reconciliation;
  return authoritativeAdapters.has(source.adapter) ? "authoritative" : "partial";
}

export function annotateSourceLeads(source, leads) {
  const sourceId = sourceIdFor(source);
  const sourceAdapter = normalize(source.adapter);
  return leads.map((lead) => ({
    ...lead,
    source_id: sourceId,
    source_adapter: sourceAdapter,
  }));
}

export async function probeRoleClosure(role, comparedAt) {
  const url = applyUrl(role);
  if (!url) return { closed: false, checked: false, reason: "missing URL" };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), closureCheckTimeoutMs);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": userAgent,
        "Accept": "text/html,application/xhtml+xml,text/plain,*/*",
      },
    });
    const html = [401, 403, 429].includes(response.status) ? "" : await response.text();
    const reason = closedPageReason(response.status, html, comparedAt)
      || (role.source_adapter === "discovery_feed" && response.ok
        ? officialPageRejection(url, response.url, html, roleTitle(role), comparedAt)
        : "");
    return { closed: Boolean(reason), checked: true, reason };
  } catch (error) {
    return { closed: false, checked: false, reason: error.message };
  } finally {
    clearTimeout(timer);
  }
}

function successfulSourceMap(scanResults) {
  const sources = new Map();
  for (const result of scanResults) {
    const terminalLog = (Array.isArray(result.log) ? result.log : [result.log]).at(-1);
    if (terminalLog?.status !== "ok" || !result.source) continue;
    const sourceId = sourceIdFor(result.source);
    sources.set(sourceId, {
      ...result.source,
      source_id: sourceId,
      reconciliation: reconciliationModeFor(result.source),
    });
  }
  return sources;
}

export async function reconcileRoleLifecycle(existing, currentCandidates, scanResults, scannedAt, confirmedClosedUrls = []) {
  const activeKeys = new Set(currentCandidates.map((lead) => keyFor(lead.company, roleTitle(lead), lead.location, applyUrl(lead))));
  const confirmedClosed = new Set(confirmedClosedUrls.map((url) => applyUrl({ url })));
  const successfulSources = successfulSourceMap(scanResults);
  const sourcesByCompany = new Map();
  for (const source of successfulSources.values()) {
    const company = normalize(source.company).toLowerCase();
    if (!sourcesByCompany.has(company)) sourcesByCompany.set(company, []);
    sourcesByCompany.get(company).push(source);
  }

  const retained = [];
  const closureCandidates = [];
  const removed = [];
  for (const role of existing) {
    if (!isAllowedLocation(role) || !isFreshEnough(role)) {
      removed.push({ role, reason: "no longer matches board eligibility policy" });
      continue;
    }
    if (confirmedClosed.has(applyUrl(role))) {
      removed.push({ role, reason: "official verification confirmed closure" });
      continue;
    }
    const key = keyFor(role.company, roleTitle(role), role.location, applyUrl(role));
    if (activeKeys.has(key)) {
      retained.push(role);
      continue;
    }
    if (isExpiredDate(role.expires_at, scannedAt)) {
      removed.push({ role, reason: "expired" });
      continue;
    }
    const inferredSources = sourcesByCompany.get(normalize(role.company).toLowerCase()) ?? [];
    const source = successfulSources.get(normalize(role.source_id))
      ?? (role.source_adapter === "discovery_feed" ? successfulSources.get(`${normalize(role.company).toLowerCase()}|discovery_feed`) : null)
      ?? (inferredSources.length === 1 ? inferredSources[0] : null);
    if (!source) {
      retained.push(role);
      continue;
    }
    if (source.reconciliation === "authoritative") {
      removed.push({ role, reason: "missing from authoritative source" });
      continue;
    }
    closureCandidates.push(role);
  }

  const checks = await mapConcurrent(closureCandidates, closureCheckConcurrency, async (role) => ({
    role,
    result: await probeRoleClosure(role, scannedAt),
  }));
  for (const check of checks) {
    if (check.result.closed) removed.push({ role: check.role, reason: check.result.reason });
    else retained.push(check.role);
  }
  return {
    roles: retained,
    removed,
    closure_checks: checks.length,
    closure_checks_confirmed: checks.filter((check) => check.result.closed).length,
  };
}
