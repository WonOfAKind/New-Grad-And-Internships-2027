import { createHash } from "node:crypto";

import {
  earlyCareerPatterns,
  internshipEligiblePatterns,
  staleAfterDays,
  targetGradPatterns,
} from "./config.mjs";
import {
  applyUrl,
  boardDisciplines,
  categorizeDisciplines,
  dateOnly,
  disciplineName,
  isAllowedLocation,
  isFreshEnough,
  keyFor,
  normalize,
  normalizeCompanyName,
  normalizeDisplayText,
  normalizePostingDate,
  roleTitle,
  roleType,
  specialtiesFor,
} from "./domain.mjs";
import { isHttpUrl } from "./http.mjs";
import { companyDetails, featuredLegend } from "./companies.mjs";

export function flattenLogs(results) {
  return results.flatMap((result) => Array.isArray(result.log) ? result.log : [result.log]);
}

export function terminalSourceStatuses(scanLog) {
  const latestBySource = new Map();
  for (const entry of scanLog) {
    latestBySource.set(`${entry.company}|${entry.adapter}`, entry);
  }
  return [...latestBySource.values()];
}

export function normalizedErrorCategory(errorMessage) {
  const value = normalize(errorMessage);
  const status = value.match(/\b(4\d\d|5\d\d)\b/)?.[1];
  const statusLabels = {
    400: "Bad Request",
    401: "Unauthorized",
    403: "Forbidden",
    404: "Not Found",
    408: "Request Timeout",
    429: "Too Many Requests",
    500: "Internal Server Error",
    502: "Bad Gateway",
    503: "Service Unavailable",
    504: "Gateway Timeout",
  };
  if (status) return `${status} ${statusLabels[status] ?? "HTTP Error"}`;
  if (/timed?\s*out|timeout|aborted/i.test(value)) return "Request Timeout";
  if (/fetch failed|econnreset|etimedout|socket/i.test(value)) return "Network Error";
  return value || "Unknown Error";
}

export function errorBreakdown(entries) {
  return entries
    .filter((entry) => entry.status === "error")
    .reduce((counts, entry) => {
      const key = normalizedErrorCategory(entry.error);
      counts[key] = (counts[key] ?? 0) + 1;
      return counts;
    }, {});
}

export function dedupeLeads(existing, candidates) {
  const seen = new Set(existing.map((lead) => keyFor(lead.company, roleTitle(lead), lead.location, applyUrl(lead))));
  const fresh = [];
  for (const candidate of candidates) {
    const key = keyFor(candidate.company, roleTitle(candidate), candidate.location, applyUrl(candidate));
    if (!seen.has(key)) {
      seen.add(key);
      fresh.push(candidate);
    }
  }
  return fresh;
}

export function capByCompany(leads, limit) {
  const counts = new Map();
  const capped = [];
  for (const lead of leads) {
    const count = counts.get(lead.company) ?? 0;
    if (count >= limit) continue;
    counts.set(lead.company, count + 1);
    capped.push(lead);
  }
  return capped;
}

export function toPublicRole(lead, scannedAt, { seenNow = true } = {}) {
  const title = roleTitle(lead);
  const context = `${lead.graduation_match ?? ""}\n${lead.category ?? ""}\n${lead.fit_notes ?? ""}`;
  const type = roleType(title, context) || lead.role_type || "New Grad";
  const disciplineContext = `${lead.description ?? ""}\n${lead.category ?? ""}\n${lead.fit_notes ?? ""}`;
  const disciplines = categorizeDisciplines(title, disciplineContext);
  const discipline = disciplineName(disciplines[0]);
  const url = applyUrl(lead);
  const company = normalizeCompanyName(lead.company);
  const companyInfo = companyDetails(company);
  const existingGradWindow = normalize(lead.grad_window);
  const inferredGradWindow = internshipEligiblePatterns.some((pattern) => pattern.test(title))
    ? "2027 internship eligible"
    : (targetGradPatterns.some((pattern) => pattern.test(title)) || /\b2027\b/.test(title)
        ? "2027 grad eligible"
        : (earlyCareerPatterns.some((pattern) => pattern.test(title)) ? "Early career" : ""));
  const currentEvidence = normalize(lead.graduation_match);
  const gradWindow = type === "Internship"
    ? (inferredGradWindow === "2027 internship eligible" ? inferredGradWindow : "")
      || (/internship/i.test(currentEvidence) ? currentEvidence : "")
      || (/internship/i.test(existingGradWindow) ? existingGradWindow : "")
      || "Internship"
    : (!/internship/i.test(currentEvidence) ? currentEvidence : "")
      || (inferredGradWindow !== "2027 internship eligible" ? inferredGradWindow : "")
      || (!/internship/i.test(existingGradWindow) ? existingGradWindow : "")
      || "New grad or university grad";
  const scannedOn = dateOnly(scannedAt);
  const candidateFirstSeen = dateOnly(lead.date_seen) || dateOnly(lead.detected_date) || scannedOn;
  const firstSeen = scannedOn && candidateFirstSeen > scannedOn ? scannedOn : candidateFirstSeen;
  const priorLastSeen = dateOnly(lead.last_seen) || firstSeen;
  const roleId = createHash("sha256")
    .update(keyFor(company, title, lead.location, url))
    .digest("hex")
    .slice(0, 24);
  return {
    role_id: roleId,
    company_id: companyInfo.id,
    company,
    featured_company: companyInfo.featured,
    title: normalize(title),
    location: normalizeDisplayText(lead.location).replace(/(?:,\s*)?\[object Object\]/gi, "").trim(),
    role_type: type,
    discipline,
    disciplines,
    specialties: specialtiesFor(title),
    compensation: normalize(lead.compensation),
    grad_window: gradWindow,
    url,
    source: normalize(lead.career_source_url) || normalize(lead.source) || url,
    date_seen: firstSeen,
    last_seen: seenNow ? scannedOn : priorLastSeen,
    posted_at: normalizePostingDate(lead.posted_at, firstSeen || scannedAt),
    expires_at: normalizePostingDate(lead.expires_at, firstSeen || scannedAt),
    updated_at: normalize(lead.updated_at),
    source_id: normalize(lead.source_id),
    source_adapter: normalize(lead.source_adapter),
    discovered_via: normalize(lead.discovered_via),
    verification_status: normalize(lead.verification_status),
    verified_at: normalize(lead.verified_at),
    verification_version: Number(lead.verification_version) || 0,
    priority: normalize(lead.priority) || "P1",
  };
}

export function mergeRoles(existing, candidates, scannedAt) {
  const byKey = new Map();
  for (const role of existing.map((lead) => toPublicRole(lead, scannedAt, { seenNow: false }))) {
    byKey.set(keyFor(role.company, role.title, role.location, role.url), role);
  }
  for (const role of candidates.map((lead) => toPublicRole(lead, scannedAt))) {
    const key = keyFor(role.company, role.title, role.location, role.url);
    const existingRole = byKey.get(key);
    byKey.set(key, {
      ...existingRole,
      ...role,
      title: /\.\.\.$/.test(role.title) && existingRole?.title ? existingRole.title : role.title,
      location: /\.\.\.$/.test(role.location) && existingRole?.location ? existingRole.location : role.location,
      compensation: role.compensation || existingRole?.compensation || "",
      date_seen: existingRole?.date_seen || role.date_seen,
      posted_at: role.posted_at || existingRole?.posted_at || "",
      expires_at: role.expires_at || existingRole?.expires_at || "",
      source_id: role.source_id || existingRole?.source_id || "",
      source_adapter: role.source_adapter || existingRole?.source_adapter || "",
      discovered_via: role.discovered_via || existingRole?.discovered_via || "",
      verification_status: role.verification_status || existingRole?.verification_status || "",
      verified_at: role.verified_at || existingRole?.verified_at || "",
      verification_version: role.verification_version || existingRole?.verification_version || 0,
      last_seen: dateOnly(scannedAt),
    });
  }
  return [...byKey.values()].sort(compareRoles);
}

export function assertBoardIntegrity(roles) {
  const validTypes = new Set(["New Grad", "Internship"]);
  const validDisciplines = new Set(boardDisciplines.map((discipline) => discipline.slug));
  for (const role of roles) {
    if (!validTypes.has(role.role_type)) {
      throw new Error(`Invalid board role type for ${role.company} - ${role.title}: ${role.role_type}`);
    }
    if (role.role_type === "New Grad" && roleType(role.title, "") === "Internship") {
      throw new Error(`Internship leaked into New Grad board: ${role.company} - ${role.title}`);
    }
    if (!Array.isArray(role.disciplines) || role.disciplines.length === 0
      || role.disciplines.some((discipline) => !validDisciplines.has(discipline))) {
      throw new Error(`Invalid discipline assignment for ${role.company} - ${role.title}`);
    }
  }
  return true;
}

export function isRecentlySeen(role, scannedAt) {
  const lastSeenMs = Date.parse(role.last_seen || role.date_seen || "");
  if (Number.isNaN(lastSeenMs)) return true;
  return Date.parse(scannedAt) - lastSeenMs <= staleAfterDays * 24 * 60 * 60 * 1000;
}

export function compareRoles(a, b) {
  const typeOrder = { "New Grad": 0, "Internship": 1 };
  const disciplineOrder = Object.fromEntries(boardDisciplines.map((discipline, index) => [discipline.name, index]));
  return (typeOrder[a.role_type] ?? 9) - (typeOrder[b.role_type] ?? 9)
    || (disciplineOrder[a.discipline] ?? 9) - (disciplineOrder[b.discipline] ?? 9)
    || roleFreshnessTime(b) - roleFreshnessTime(a)
    || a.company.localeCompare(b.company)
    || a.title.localeCompare(b.title)
    || a.location.localeCompare(b.location);
}

export function roleFreshnessTime(role) {
  const parsed = Date.parse(role.posted_at || role.date_seen || "");
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function csvEscape(value) {
  let text = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function rolesToCsv(roles) {
  const columns = ["role_id", "company_id", "company", "featured_company", "title", "location", "role_type", "discipline", "disciplines", "specialties", "compensation", "grad_window", "url", "source", "discovered_via", "verification_status", "verified_at", "verification_version", "date_seen", "last_seen", "posted_at", "expires_at", "source_id", "source_adapter", "updated_at", "priority"];
  return [
    columns.join(","),
    ...roles.map((role) => columns.map((column) => csvEscape(Array.isArray(role[column]) ? role[column].join(";") : role[column])).join(",")),
  ].join("\n") + "\n";
}

export function markdownLink(label, url) {
  if (!isHttpUrl(url)) return label;
  return `[${label}](<${String(url).replace(/>/g, "%3E")}>)`;
}

export function markdownEscape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\|/g, "\\|")
    .replace(/\n/g, " ");
}

export function renderTable(roles) {
  if (roles.length === 0) return "_No roles found yet._\n";
  const lines = [
    "| Company | Role | Location | Salary / Hourly | Grad Window | Posted / First Seen | Apply |",
    "|---|---|---|---|---|---|---|",
  ];
  for (const role of [...roles].sort(compareRoles)) {
    const company = `${role.featured_company ? "🔥 " : ""}${role.company}`;
    lines.push(`| ${markdownEscape(company)} | ${markdownEscape(role.title)} | ${markdownEscape(role.location)} | ${markdownEscape(role.compensation || "-")} | ${markdownEscape(role.grad_window)} | ${renderRoleDates(role)} | ${markdownLink("Apply", role.url)} |`);
  }
  return `${lines.join("\n")}\n`;
}

export function formatBoardDate(value) {
  const date = dateOnly(value);
  if (!date) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${date}T00:00:00Z`));
}

export function renderRoleDates(role) {
  const firstSeen = formatBoardDate(role.date_seen);
  const posted = formatBoardDate(role.posted_at);
  if (!posted) return `First seen ${markdownEscape(firstSeen || "Unknown")}`;
  return `Posted ${markdownEscape(posted)}<br>First seen ${markdownEscape(firstSeen || "Unknown")}`;
}

export function formatReadmeTimestamp(value) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return "Not scanned yet";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}

export function rolesForDiscipline(roles, roleTypeName, disciplineSlug) {
  return roles.filter((role) => role.role_type === roleTypeName
    && (Array.isArray(role.disciplines)
      ? role.disciplines.includes(disciplineSlug)
      : role.discipline === disciplineName(disciplineSlug)));
}

export function renderRolePage(roles, coverage, roleTypeName) {
  const matchingRoles = roles.filter((role) => role.role_type === roleTypeName);
  const title = roleTypeName === "Internship" ? "2027 Internship Roles" : "2027 New Grad Roles";
  const directory = roleTypeName === "Internship" ? "internships" : "new-grad";
  const otherBoard = roleTypeName === "Internship"
    ? "[New Grad Roles](NEW_GRAD.md)"
    : "[Internship Roles](INTERNSHIPS.md)";
  const categoryRows = boardDisciplines
    .map((discipline) => ({ ...discipline, count: rolesForDiscipline(roles, roleTypeName, discipline.slug).length }))
    .map((discipline) => `| [${discipline.name}](${directory}/${discipline.slug}.md) | ${discipline.count} |`)
    .join("\n");

  return `# ${title}

[Project overview](README.md) | ${otherBoard}

Last updated: ${formatReadmeTimestamp(coverage.scanned_at)}

Current roles: ${matchingRoles.length}

Choose a category below. Cross-disciplinary roles can appear in more than one category, while the total above counts each role once.

| Category | Roles |
|---|---:|
${categoryRows}

🔥 ${featuredLegend()}
`;
}

export function renderDisciplinePage(roles, coverage, roleTypeName, discipline) {
  const matching = rolesForDiscipline(roles, roleTypeName, discipline.slug);
  const boardTitle = roleTypeName === "Internship" ? "Internships" : "New Grad";
  const indexPath = roleTypeName === "Internship" ? "../INTERNSHIPS.md" : "../NEW_GRAD.md";
  return `# 2027 ${boardTitle}: ${discipline.name}

[Project overview](../README.md) | [All ${boardTitle} Categories](${indexPath})

Last updated: ${formatReadmeTimestamp(coverage.scanned_at)}

Current roles in this view: ${matching.length}

🔥 ${featuredLegend()}

Roles are sorted newest-first. Always verify availability and details on the official posting before applying.

${renderTable(matching)}
`;
}

export function renderReadme(roles, coverage, freshCount) {
  const newGradCount = roles.filter((role) => role.role_type === "New Grad").length;
  const internshipCount = roles.filter((role) => role.role_type === "Internship").length;
  return `# New Grad and Internship Roles 2027

Public, GitHub Actions-powered tracker for 2027 new grad and internship roles.

Tracked disciplines:

${boardDisciplines.map((discipline) => `- ${discipline.name}`).join("\n")}

This board is generated from official company career pages and ATS pages where possible. It is intended for discovery only; always verify the posting on the company site before applying.

[Contributors](CONTRIBUTORS.md)

[Get company-specific email notifications](docs/notifications/)

Last updated: ${formatReadmeTimestamp(coverage.scanned_at)}

Companies in registry: ${coverage.companies_in_target_list}

Companies successfully scanned: ${coverage.companies_with_active_sources ?? 0}

Current roles: ${roles.length}

Fresh roles this scan: ${freshCount}

Structured sources active: ${coverage.structured_sources_runtime ?? coverage.ats_sources_configured}

Automatically discovered companies: ${coverage.discovered_companies_active ?? 0}

Secondary discovery feeds healthy: ${coverage.discovery_feeds?.feeds_ok ?? 0}/${coverage.discovery_feeds?.feeds_configured ?? 0}

## Role Boards

- [New Grad Roles](NEW_GRAD.md): ${newGradCount} roles
- [Internship Roles](INTERNSHIPS.md): ${internshipCount} roles

## Data Files

- [data/roles.json](data/roles.json)
- [data/roles.csv](data/roles.csv)
- [data/latest_scan.json](data/latest_scan.json)
- [data/coverage.json](data/coverage.json)
- [data/source_discovery.json](data/source_discovery.json)
- [docs/DISCIPLINE_COVERAGE.md](docs/DISCIPLINE_COVERAGE.md)
- [docs/ADDING_SOURCES.md](docs/ADDING_SOURCES.md)
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

## Notes

- This repository does not submit applications.
- Personal application status, resumes, and private notes should not be committed here.
- Salary/hourly data is extracted only when the official posting text exposes it.
- New-grad rows must explicitly identify a new-grad/graduate/college-grad role, name the 2027 graduation cycle, state a Summer 2027 start, or combine a level-one title with explicit early-career and bachelor's eligibility on the official posting. Generic early-career, entry-level, and level-one wording does not qualify by itself.
- New ATS sources, official job links, JSON-LD, and job sitemaps are discovered and cached automatically.
- Curated 2027 community lists are used only as secondary discovery inputs. Their cycle labels are not eligibility evidence. A row is published only with an individual employer/ATS requisition URL, and unseen URLs must pass a live official-page check first.
- Curated source configuration remains available for sites that do not expose a standard machine-readable surface.
- Company posting dates and this tracker's first-seen dates are stored separately; tables are newest-first within each section.
- Closed roles disappear immediately when a complete ATS feed drops them or a partial source confirms closure. Unverifiable roles are removed after ${staleAfterDays} days without a successful sighting.
- Generated files are updated by \`.github/workflows/monitor.yml\`.
`;
}
