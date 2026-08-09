import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  doubleCheckErrors,
  discoveryVerificationVersion,
  discoveryFeedConcurrency,
  discoveryFeedTimeoutMs,
  maxNewPerCompany,
  minAtsSuccessPercent,
  staleAfterDays,
  startedAt,
} from "./monitor/config.mjs";
import {
  boardDisciplines,
  applyUrl,
  isAllowedLocation,
  isExpiredDate,
  isFreshEnough,
  keyFor,
  mapConcurrent,
  roleTitle,
} from "./monitor/domain.mjs";
import { reconcileRoleLifecycle } from "./monitor/lifecycle.mjs";
import { readJson, validateConfiguration } from "./monitor/http.mjs";
import {
  configureAdapterContext,
  scanAtsSources,
} from "./monitor/adapters.mjs";
import { discoverSources } from "./monitor/discovery.mjs";
import {
  providerDescriptorForSeed,
  isCareerLandingPageUrl,
  scanDiscoveryFeeds,
  validateDiscoveryFeeds,
  verifyKnownProvider,
} from "./monitor/feed_discovery.mjs";
import {
  assertBoardIntegrity,
  capByCompany,
  dedupeLeads,
  errorBreakdown,
  flattenLogs,
  isRecentlySeen,
  mergeRoles,
  renderReadme,
  renderDisciplinePage,
  renderRolePage,
  rolesToCsv,
  terminalSourceStatuses,
  toPublicRole,
} from "./monitor/output.mjs";
import {
  configureCompanyMetadata,
  publicCompanyCatalog,
} from "./monitor/companies.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const dataDir = path.join(rootDir, "data");

const targetPath = path.join(dataDir, "company_sources.json");
const companyMetadataPath = path.join(dataDir, "company_metadata.json");
const sourcePath = path.join(dataDir, "ats_sources.json");
const feedPath = path.join(dataDir, "discovery_feeds.json");
const discoveryPath = path.join(dataDir, "source_discovery.json");
const roleDataPath = path.join(dataDir, "roles.json");
const scanOutputPath = path.join(dataDir, "latest_scan.json");
const coverageOutputPath = path.join(dataDir, "coverage.json");
const csvOutputPath = path.join(dataDir, "roles.csv");
const companyCatalogPath = path.join(dataDir, "company_catalog.json");
const notificationOutboxPath = path.join(dataDir, "notification_outbox.json");
const readmePath = path.join(rootDir, "README.md");
const newGradPath = path.join(rootDir, "NEW_GRAD.md");
const internshipsPath = path.join(rootDir, "INTERNSHIPS.md");
const newGradDir = path.join(rootDir, "new-grad");
const internshipsDir = path.join(rootDir, "internships");
const notificationsDocsDir = path.join(rootDir, "docs", "notifications");
const notificationCatalogPath = path.join(notificationsDocsDir, "catalog.json");

await fs.mkdir(dataDir, { recursive: true });
await fs.mkdir(newGradDir, { recursive: true });
await fs.mkdir(internshipsDir, { recursive: true });
await fs.mkdir(notificationsDocsDir, { recursive: true });
const targets = await readJson(targetPath, []);
const companyMetadata = await readJson(companyMetadataPath, { companies: [], recommendation_presets: [] });
const atsSources = await readJson(sourcePath, []);
const discoveryFeeds = await readJson(feedPath, []);
const discoveryState = await readJson(discoveryPath, { version: 3, companies: {} });
const existingLeads = await readJson(roleDataPath, []);
validateConfiguration(targets, atsSources);
validateDiscoveryFeeds(discoveryFeeds);
if (!Array.isArray(existingLeads)) throw new Error("data/roles.json must contain a JSON array");
configureCompanyMetadata(companyMetadata);
const discovery = await discoverSources(targets, atsSources, discoveryState);
const configuredSources = atsSources.map((source) => ({ ...source, source_kind: "configured" }));
const runtimeSources = [...configuredSources, ...discovery.sources];
validateConfiguration(targets, runtimeSources);
configureAdapterContext(targets, runtimeSources);

const allCandidates = [];
const scanLog = [];
const atsScan = await scanAtsSources(runtimeSources);
allCandidates.push(...atsScan.flatMap((result) => result.leads));
scanLog.push(...flattenLogs(atsScan));
const feedScan = await scanDiscoveryFeeds(discoveryFeeds, existingLeads, runtimeSources);
allCandidates.unshift(...feedScan.leads);

const scannedAt = new Date().toISOString();
const preliminaryBoardEligibleCandidates = allCandidates
  .filter((lead) => !isExpiredDate(lead.expires_at, scannedAt))
  .filter(isFreshEnough)
  .filter(isAllowedLocation)
  .filter((lead) => !isCareerLandingPageUrl(applyUrl(lead)))
  .filter((lead) => lead.priority !== "P2")
  .sort((a, b) => {
    const priorityRank = { P0: 0, P1: 1, P2: 2 };
    const priorityDiff = (priorityRank[a.priority] ?? 9) - (priorityRank[b.priority] ?? 9);
    if (priorityDiff !== 0) return priorityDiff;
    const gradDiff = (b.graduation_match === "2027 grad eligible" ? 1 : 0) - (a.graduation_match === "2027 grad eligible" ? 1 : 0);
    if (gradDiff !== 0) return gradDiff;
    return Date.parse(b.updated_at || "0") - Date.parse(a.updated_at || "0");
  });
const providerVerificationCache = new Map();
const providerCandidateChecks = await mapConcurrent(
  preliminaryBoardEligibleCandidates
    .filter((lead) => lead.source_adapter !== "discovery_feed")
    .filter((lead) => providerDescriptorForSeed({ ...lead, url: applyUrl(lead) }, runtimeSources)),
  discoveryFeedConcurrency,
  async (lead) => {
    try {
      const verifiedJob = await verifyKnownProvider(
        { ...lead, url: applyUrl(lead), title: roleTitle(lead) },
        runtimeSources,
        discoveryFeedTimeoutMs,
        providerVerificationCache,
      );
      return {
        lead: verifiedJob?.url ? { ...lead, direct_apply_url: verifiedJob.url } : lead,
        original_url: applyUrl(lead),
        status: "active",
        error: "",
      };
    } catch (error) {
      return {
        lead,
        status: /^official posting closed:/i.test(error.message) ? "closed" : "unavailable",
        error: error.message,
      };
    }
  },
);
const rejectedProviderCandidateUrls = new Set(providerCandidateChecks
  .filter((check) => check.status !== "active")
  .map((check) => check.original_url || applyUrl(check.lead)));
const closedProviderCandidateUrls = providerCandidateChecks
  .filter((check) => check.status === "closed")
  .map((check) => applyUrl(check.lead));
const boardEligibleCandidates = preliminaryBoardEligibleCandidates
  .filter((lead) => !rejectedProviderCandidateUrls.has(applyUrl(lead)))
  .map((lead) => providerCandidateChecks.find((check) => check.original_url === applyUrl(lead))?.lead ?? lead);
const activeCandidateKeys = new Set(boardEligibleCandidates.map((lead) => keyFor(
  lead.company,
  roleTitle(lead),
  lead.location,
  applyUrl(lead),
)));
const inactiveProviderRoles = existingLeads.filter((role) => !activeCandidateKeys.has(keyFor(
  role.company,
  roleTitle(role),
  role.location,
  applyUrl(role),
)) && providerDescriptorForSeed(role, runtimeSources));
const inactiveProviderChecks = await mapConcurrent(
  inactiveProviderRoles,
  discoveryFeedConcurrency,
  async (role) => {
    try {
      await verifyKnownProvider(role, runtimeSources, discoveryFeedTimeoutMs, providerVerificationCache);
      return { role, status: "active", error: "" };
    } catch (error) {
      return {
        role,
        status: /^official posting closed:/i.test(error.message) ? "closed" : "unavailable",
        error: error.message,
      };
    }
  },
);
const inactiveProviderClosedUrls = inactiveProviderChecks
  .filter((check) => check.status === "closed")
  .map((check) => applyUrl(check.role));
const providerUnavailableUrls = new Set([
  ...providerCandidateChecks.filter((check) => check.status === "unavailable").map((check) => applyUrl(check.lead)),
  ...inactiveProviderChecks.filter((check) => check.status === "unavailable").map((check) => applyUrl(check.role)),
]);
const lifecycle = await reconcileRoleLifecycle(
  existingLeads,
  boardEligibleCandidates,
  [...atsScan, ...feedScan.scan_results],
  scannedAt,
  [...feedScan.confirmed_closed_urls, ...closedProviderCandidateUrls, ...inactiveProviderClosedUrls],
);
const allFreshLeads = dedupeLeads(existingLeads, boardEligibleCandidates);
const freshLeads = capByCompany(allFreshLeads, maxNewPerCompany);

const finalSourceStatuses = terminalSourceStatuses(scanLog);
let discoveryStateChanged = false;
for (const status of finalSourceStatuses.filter((entry) => entry.source_kind === "discovered")) {
  const record = discovery.state.companies[status.company.toLowerCase()];
  if (!record) continue;
  const error = status.error ?? "";
  if (record.last_scan_status !== status.status || record.last_scan_error !== error) {
    record.last_scan_at = scannedAt;
    record.last_scan_status = status.status;
    record.last_scan_error = error;
    if (status.status === "ok") record.last_verified_at = scannedAt;
    discoveryStateChanged = true;
  }
}
if (discoveryStateChanged) discovery.state.updated_at = scannedAt;
const configuredSourceKeys = new Set(configuredSources.map((source) => `${source.company}|${source.adapter}`));
const finalConfiguredStatuses = finalSourceStatuses.filter((entry) => configuredSourceKeys.has(`${entry.company}|${entry.adapter}`));
const atsOkSources = finalConfiguredStatuses.filter((entry) => entry.status === "ok").length;
const atsSuccessPercent = finalConfiguredStatuses.length === 0 ? 0 : Math.round((atsOkSources / finalConfiguredStatuses.length) * 1000) / 10;
const discoveredCompanyCount = new Set(discovery.sources.map((source) => source.company)).size;
const coverage = {
  scanned_at: scannedAt,
  elapsed_ms: Date.now() - startedAt,
  companies_in_target_list: targets.length,
  ats_sources_configured: atsSources.length,
  structured_sources_runtime: runtimeSources.length,
  discovered_sources_active: discovery.sources.length,
  discovered_companies_active: discoveredCompanyCount,
  companies_with_active_sources: new Set(finalSourceStatuses
    .filter((entry) => entry.status === "ok")
    .map((entry) => entry.company)).size,
  discovery_feeds: feedScan.coverage,
  discovery_attempts_this_scan: discovery.attempted,
  discovery_new_sources_this_scan: discovery.discovered_now,
  discovery_due_remaining: discovery.due_remaining,
  discovery_status_counts: discovery.status_counts,
  direct_sources_attempted: 0,
  double_check_enabled: doubleCheckErrors,
  double_check_attempts: scanLog.filter((entry) => entry.phase === "double-check").length,
  unique_sources_attempted: finalSourceStatuses.length,
  total_fetch_attempts: scanLog.length,
  ok_sources: finalSourceStatuses.filter((entry) => entry.status === "ok").length,
  error_sources: finalSourceStatuses.filter((entry) => entry.status === "error").length,
  blocked_sources: finalSourceStatuses.filter((entry) => entry.status === "blocked").length,
  ats_ok_sources: atsOkSources,
  ats_error_sources: finalConfiguredStatuses.filter((entry) => entry.status === "error").length,
  ats_blocked_sources: finalConfiguredStatuses.filter((entry) => entry.status === "blocked").length,
  ats_success_percent: atsSuccessPercent,
  minimum_ats_success_percent: minAtsSuccessPercent,
  error_breakdown: errorBreakdown(finalSourceStatuses),
  board_eligible_candidates: boardEligibleCandidates.length,
  provider_candidate_checks: providerCandidateChecks.length,
  provider_candidate_closed: closedProviderCandidateUrls.length,
  provider_candidate_unavailable: providerCandidateChecks.filter((check) => check.status === "unavailable").length,
  closure_checks: lifecycle.closure_checks,
  inactive_provider_checks: inactiveProviderChecks.length,
  inactive_provider_closed: inactiveProviderClosedUrls.length,
  inactive_provider_unavailable: inactiveProviderChecks.filter((check) => check.status === "unavailable").length,
  closed_roles_removed: lifecycle.removed.filter((entry) => entry.reason !== "expired").length,
  expired_roles_removed: lifecycle.removed.filter((entry) => entry.reason === "expired").length,
  stale_after_days: staleAfterDays,
  unattempted_companies: targets
    .filter((target) => !atsSources.some((source) => source.company === target.company)
      && !discovery.state.companies[target.company.toLowerCase()])
    .map((target) => target.company),
};
const publicFreshLeads = freshLeads.map((lead) => toPublicRole(lead, scannedAt));
const notificationFreshLeads = allFreshLeads.map((lead) => toPublicRole(lead, scannedAt));
const updatedLeads = mergeRoles(lifecycle.roles, boardEligibleCandidates, scannedAt)
  .filter((role) => isRecentlySeen(role, scannedAt))
  .filter(isFreshEnough)
  .filter(isAllowedLocation)
  .filter((role) => !isCareerLandingPageUrl(applyUrl(role)))
  .filter((role) => !providerUnavailableUrls.has(applyUrl(role)))
  .filter((role) => role.source_adapter !== "discovery_feed"
    || Number(role.verification_version) === discoveryVerificationVersion)
  .filter((role) => role.priority !== "P2");
assertBoardIntegrity(updatedLeads);
const currentRoleIds = new Set(updatedLeads.map((role) => role.role_id));
const notificationRoles = notificationFreshLeads.filter((role) => currentRoleIds.has(role.role_id));
const companyCatalog = publicCompanyCatalog(targets);
companyCatalog.generated_at = scannedAt;
await fs.writeFile(roleDataPath, `${JSON.stringify(updatedLeads, null, 2)}\n`, "utf8");
await fs.writeFile(discoveryPath, `${JSON.stringify(discovery.state, null, 2)}\n`, "utf8");
await fs.writeFile(csvOutputPath, rolesToCsv(updatedLeads), "utf8");
await fs.writeFile(companyCatalogPath, `${JSON.stringify(companyCatalog, null, 2)}\n`, "utf8");
await fs.writeFile(notificationCatalogPath, `${JSON.stringify(companyCatalog, null, 2)}\n`, "utf8");
await fs.writeFile(notificationOutboxPath, `${JSON.stringify({
  scan_id: scannedAt,
  generated_at: scannedAt,
  companies: companyCatalog.companies,
  roles: notificationRoles,
}, null, 2)}\n`, "utf8");
await fs.writeFile(scanOutputPath, `${JSON.stringify({
  scanned_at: scannedAt,
  fresh_leads: publicFreshLeads,
  removed_roles: lifecycle.removed.map((entry) => ({
    company: entry.role.company,
    title: entry.role.title,
    url: entry.role.url,
    reason: entry.reason,
  })),
  scan_log: scanLog,
  coverage,
}, null, 2)}\n`, "utf8");
await fs.writeFile(coverageOutputPath, `${JSON.stringify(coverage, null, 2)}\n`, "utf8");
await fs.writeFile(readmePath, renderReadme(updatedLeads, coverage, publicFreshLeads.length), "utf8");
await fs.writeFile(newGradPath, renderRolePage(updatedLeads, coverage, "New Grad"), "utf8");
await fs.writeFile(internshipsPath, renderRolePage(updatedLeads, coverage, "Internship"), "utf8");
for (const discipline of boardDisciplines) {
  await fs.writeFile(
    path.join(newGradDir, `${discipline.slug}.md`),
    renderDisciplinePage(updatedLeads, coverage, "New Grad", discipline),
    "utf8",
  );
  await fs.writeFile(
    path.join(internshipsDir, `${discipline.slug}.md`),
    renderDisciplinePage(updatedLeads, coverage, "Internship", discipline),
    "utf8",
  );
}

console.log(JSON.stringify({
  scanned_at: scannedAt,
  elapsed_ms: Date.now() - startedAt,
  companies_in_target_list: targets.length,
  ats_sources_configured: atsSources.length,
  structured_sources_runtime: runtimeSources.length,
  discovery_attempts: discovery.attempted,
  discovery_new_sources: discovery.discovered_now,
  discovery_due_remaining: discovery.due_remaining,
  double_check_attempts: coverage.double_check_attempts,
  unique_sources_attempted: coverage.unique_sources_attempted,
  total_fetch_attempts: coverage.total_fetch_attempts,
  ok_sources: coverage.ok_sources,
  error_sources: coverage.error_sources,
  blocked_sources: coverage.blocked_sources,
  unattempted_companies: coverage.unattempted_companies.length,
  candidates: allCandidates.length,
  current_roles: updatedLeads.length,
  fresh_leads: publicFreshLeads.length,
  closed_roles_removed: coverage.closed_roles_removed,
  expired_roles_removed: coverage.expired_roles_removed,
  fresh: publicFreshLeads.slice(0, 10).map((lead) => ({
    company: lead.company,
    title: lead.title,
    location: lead.location,
    role_type: lead.role_type,
    discipline: lead.discipline,
    priority: lead.priority,
    url: lead.url,
  })),
  truncated_fresh_output: publicFreshLeads.length > 10,
}, null, 2));
if (atsSuccessPercent < minAtsSuccessPercent) {
  console.error(`ATS source success rate ${atsSuccessPercent}% is below the required ${minAtsSuccessPercent}%`);
  process.exit(1);
}
process.exit(0);
