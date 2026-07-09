import {
  earlyCareerPatterns,
  internshipEligiblePatterns,
  staleAfterDays,
  targetGradPatterns,
} from "./config.mjs";
import {
  applyUrl,
  categorize,
  isAllowedLocation,
  isFreshEnough,
  keyFor,
  normalize,
  roleTitle,
  roleType,
} from "./domain.mjs";
import { isHttpUrl } from "./http.mjs";

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

export function toPublicRole(lead, scannedAt) {
  const title = roleTitle(lead);
  const context = `${lead.graduation_match ?? ""}\n${lead.category ?? ""}\n${lead.fit_notes ?? ""}`;
  const type = roleType(title, context) || lead.role_type || "New Grad";
  const discipline = categorize(title);
  const url = applyUrl(lead);
  const existingGradWindow = normalize(lead.grad_window);
  const inferredGradWindow = internshipEligiblePatterns.some((pattern) => pattern.test(title))
    ? "2027 internship eligible"
    : (targetGradPatterns.some((pattern) => pattern.test(title)) || /\b2027\b/.test(title)
        ? "2027 grad eligible"
        : (earlyCareerPatterns.some((pattern) => pattern.test(title)) ? "Early career" : ""));
  const gradWindow = normalize(lead.graduation_match)
    || inferredGradWindow
    || existingGradWindow
    || (type === "Internship" ? "Internship" : "New grad or university grad");
  return {
    company: normalize(lead.company),
    title: normalize(title),
    location: normalize(lead.location),
    role_type: type,
    discipline,
    compensation: normalize(lead.compensation),
    grad_window: gradWindow,
    url,
    source: normalize(lead.career_source_url) || normalize(lead.source) || url,
    date_seen: lead.detected_date || scannedAt.slice(0, 10),
    last_seen: scannedAt.slice(0, 10),
    updated_at: normalize(lead.updated_at),
    priority: normalize(lead.priority) || "P1",
  };
}

export function mergeRoles(existing, candidates, scannedAt) {
  const byKey = new Map();
  for (const role of existing.map((lead) => toPublicRole(lead, lead.last_seen || scannedAt))) {
    byKey.set(keyFor(role.company, role.title, role.location, role.url), role);
  }
  for (const role of candidates.map((lead) => toPublicRole(lead, scannedAt))) {
    const key = keyFor(role.company, role.title, role.location, role.url);
    const existingRole = byKey.get(key);
    byKey.set(key, {
      ...existingRole,
      ...role,
      compensation: role.compensation || existingRole?.compensation || "",
      date_seen: existingRole?.date_seen || role.date_seen,
      last_seen: scannedAt.slice(0, 10),
    });
  }
  return [...byKey.values()].sort(compareRoles);
}

export function isRecentlySeen(role, scannedAt) {
  const lastSeenMs = Date.parse(role.last_seen || role.date_seen || "");
  if (Number.isNaN(lastSeenMs)) return true;
  return Date.parse(scannedAt) - lastSeenMs <= staleAfterDays * 24 * 60 * 60 * 1000;
}

export function compareRoles(a, b) {
  const typeOrder = { "New Grad": 0, "Internship": 1 };
  const disciplineOrder = {
    "Software / AI / ML": 0,
    "Data Science": 1,
    "Technical Writing": 2,
    "Mechanical Engineering": 3,
    "Aerospace Engineering": 4,
    "Other": 9,
  };
  return (typeOrder[a.role_type] ?? 9) - (typeOrder[b.role_type] ?? 9)
    || (disciplineOrder[a.discipline] ?? 9) - (disciplineOrder[b.discipline] ?? 9)
    || a.company.localeCompare(b.company)
    || a.title.localeCompare(b.title)
    || a.location.localeCompare(b.location);
}

export function csvEscape(value) {
  let text = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function rolesToCsv(roles) {
  const columns = ["company", "title", "location", "role_type", "discipline", "compensation", "grad_window", "url", "source", "date_seen", "last_seen", "updated_at", "priority"];
  return [
    columns.join(","),
    ...roles.map((role) => columns.map((column) => csvEscape(role[column])).join(",")),
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
    "| Company | Role | Location | Salary / Hourly | Grad Window | Posted/Seen | Apply |",
    "|---|---|---|---|---|---|---|",
  ];
  for (const role of roles) {
    lines.push(`| ${markdownEscape(role.company)} | ${markdownEscape(role.title)} | ${markdownEscape(role.location)} | ${markdownEscape(role.compensation || "-")} | ${markdownEscape(role.grad_window)} | ${markdownEscape(role.date_seen)} | ${markdownLink("Apply", role.url)} |`);
  }
  return `${lines.join("\n")}\n`;
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

export function renderReadme(roles, coverage, freshCount) {
  const disciplines = ["Software / AI / ML", "Data Science", "Technical Writing", "Mechanical Engineering", "Aerospace Engineering", "Other"];
  const sections = [];
  for (const roleTypeName of ["New Grad", "Internship"]) {
    sections.push(`## ${roleTypeName} Roles\n`);
    for (const discipline of disciplines) {
      const matching = roles.filter((role) => role.role_type === roleTypeName && role.discipline === discipline);
      if (matching.length === 0 && discipline === "Other") continue;
      sections.push(`### ${discipline}\n\n${renderTable(matching)}`);
    }
  }
  return `# New Grad and Internship Roles 2027

Public, GitHub Actions-powered tracker for 2027 new grad and internship roles.

Tracked disciplines:

- Software / AI / ML
- Data Science
- Technical Writing
- Mechanical Engineering
- Aerospace Engineering

This board is generated from official company career pages and ATS pages where possible. It is intended for discovery only; always verify the posting on the company site before applying.

[Contributors](CONTRIBUTORS.md)

Last updated: ${formatReadmeTimestamp(coverage.scanned_at)}

Companies tracked: ${coverage.companies_in_target_list}

Current roles: ${roles.length}

Fresh roles this scan: ${freshCount}

Structured sources active: ${coverage.structured_sources_runtime ?? coverage.ats_sources_configured}

Automatically discovered companies: ${coverage.discovered_companies_active ?? 0}

${sections.join("\n")}

## Data Files

- [data/roles.json](data/roles.json)
- [data/roles.csv](data/roles.csv)
- [data/latest_scan.json](data/latest_scan.json)
- [data/coverage.json](data/coverage.json)
- [data/source_discovery.json](data/source_discovery.json)
- [docs/ADDING_SOURCES.md](docs/ADDING_SOURCES.md)
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

## Notes

- This repository does not submit applications.
- Personal application status, resumes, and private notes should not be committed here.
- Salary/hourly data is extracted only when the official posting text exposes it.
- New ATS sources, official job links, JSON-LD, and job sitemaps are discovered and cached automatically.
- Curated source configuration remains available for sites that do not expose a standard machine-readable surface.
- Roles not seen for ${staleAfterDays} days are automatically removed from the public board.
- Generated files are updated by \`.github/workflows/monitor.yml\`.
`;
}
