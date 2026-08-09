import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { boardDisciplines } from "./monitor/domain.mjs";
import { configureCompanyMetadata, publicCompanyCatalog } from "./monitor/companies.mjs";
import {
  assertBoardIntegrity,
  mergeRoles,
  renderDisciplinePage,
  renderReadme,
  renderRolePage,
  rolesToCsv,
} from "./monitor/output.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = path.join(rootDir, "data");
const readJson = async (relativePath, fallback) => {
  try {
    return JSON.parse(await fs.readFile(path.join(rootDir, relativePath), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
};

const targets = await readJson("data/company_sources.json", []);
const metadata = await readJson("data/company_metadata.json", { companies: [], recommendation_presets: [] });
const existingRoles = await readJson("data/roles.json", []);
const coverage = await readJson("data/coverage.json", { scanned_at: new Date().toISOString() });
const latestScan = await readJson("data/latest_scan.json", { fresh_leads: [] });
const existingOutbox = await readJson("data/notification_outbox.json", null);
configureCompanyMetadata(metadata, targets);

const scannedAt = coverage.scanned_at || new Date().toISOString();
const companiesWithActiveSources = new Set((latestScan.scan_log ?? [])
  .filter((entry) => entry.status === "ok")
  .map((entry) => entry.company)
  .filter(Boolean)).size;
const renderCoverage = {
  ...coverage,
  companies_in_target_list: targets.length,
  companies_with_active_sources: coverage.companies_with_active_sources ?? companiesWithActiveSources,
};
const roles = mergeRoles(existingRoles, [], scannedAt);
assertBoardIntegrity(roles);
const catalog = publicCompanyCatalog(targets);
catalog.generated_at = scannedAt;
const currentRoleIds = new Set(roles.map((role) => role.role_id));
const freshRoles = mergeRoles(latestScan.fresh_leads ?? [], [], scannedAt)
  .filter((role) => currentRoleIds.has(role.role_id));
const outboxRoles = mergeRoles(existingOutbox?.roles ?? [], [], scannedAt)
  .filter((role) => currentRoleIds.has(role.role_id));
const notificationOutbox = {
  scan_id: existingOutbox?.scan_id || scannedAt,
  generated_at: existingOutbox?.generated_at || scannedAt,
  companies: catalog.companies,
  roles: outboxRoles,
};

const newGradDir = path.join(rootDir, "new-grad");
const internshipsDir = path.join(rootDir, "internships");
const notificationsDir = path.join(rootDir, "docs", "notifications");
await Promise.all([
  fs.mkdir(dataDir, { recursive: true }),
  fs.mkdir(newGradDir, { recursive: true }),
  fs.mkdir(internshipsDir, { recursive: true }),
  fs.mkdir(notificationsDir, { recursive: true }),
]);

await Promise.all([
  fs.writeFile(path.join(dataDir, "roles.json"), `${JSON.stringify(roles, null, 2)}\n`, "utf8"),
  fs.writeFile(path.join(dataDir, "roles.csv"), rolesToCsv(roles), "utf8"),
  fs.writeFile(path.join(dataDir, "company_catalog.json"), `${JSON.stringify(catalog, null, 2)}\n`, "utf8"),
  fs.writeFile(path.join(dataDir, "latest_scan.json"), `${JSON.stringify({ ...latestScan, fresh_leads: freshRoles }, null, 2)}\n`, "utf8"),
  fs.writeFile(path.join(dataDir, "notification_outbox.json"), `${JSON.stringify(notificationOutbox, null, 2)}\n`, "utf8"),
  fs.writeFile(path.join(notificationsDir, "catalog.json"), `${JSON.stringify(catalog, null, 2)}\n`, "utf8"),
  fs.writeFile(path.join(rootDir, "README.md"), renderReadme(roles, renderCoverage, freshRoles.length), "utf8"),
  fs.writeFile(path.join(rootDir, "NEW_GRAD.md"), renderRolePage(roles, renderCoverage, "New Grad"), "utf8"),
  fs.writeFile(path.join(rootDir, "INTERNSHIPS.md"), renderRolePage(roles, renderCoverage, "Internship"), "utf8"),
  ...boardDisciplines.flatMap((discipline) => [
    fs.writeFile(
      path.join(newGradDir, `${discipline.slug}.md`),
      renderDisciplinePage(roles, renderCoverage, "New Grad", discipline),
      "utf8",
    ),
    fs.writeFile(
      path.join(internshipsDir, `${discipline.slug}.md`),
      renderDisciplinePage(roles, renderCoverage, "Internship", discipline),
      "utf8",
    ),
  ]),
]);

console.log(JSON.stringify({ roles: roles.length, companies: catalog.companies.length, categories: boardDisciplines.length }, null, 2));
