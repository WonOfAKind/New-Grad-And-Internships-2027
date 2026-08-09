import { normalizeCompanyName } from "./domain.mjs";

let metadata = { companies: [], recommendation_presets: [], featured_legend: "" };
let byName = new Map();
let byId = new Map();
let presetById = new Map();
let coverageByName = new Map();

export function companySlug(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function coverageDisciplinesFor(target) {
  const text = `${target?.bucket ?? ""}\n${target?.role_families ?? ""}`;
  const disciplines = [];
  const add = (discipline, pattern) => { if (pattern.test(text)) disciplines.push(discipline); };
  add("aerospace", /aerospace|aeronautical|avionics|propulsion|flight|space\s+systems|\bGNC\b/i);
  add("mechanical", /mechanical|mechatronics|thermal|structures|stress|materials|vehicle|automotive|powertrain|robotics|product\s+development|hydraulics/i);
  add("manufacturing-industrial", /manufactur|industrial|production|process|quality|operations/i);
  add("hardware-electrical", /hardware|electrical|electronics|avionics|embedded|firmware|semiconductor|controls/i);
  return [...new Set(disciplines)];
}

export function configureCompanyMetadata(value = {}, targets = []) {
  if (!value || typeof value !== "object" || !Array.isArray(value.companies)) {
    throw new Error("company_metadata.json must define a companies array");
  }
  const ids = new Set();
  const names = new Set();
  const presets = Array.isArray(value.recommendation_presets) ? value.recommendation_presets : [];
  const presetIds = new Set();
  for (const [index, preset] of presets.entries()) {
    if (!preset?.id || !preset?.name || preset.id !== companySlug(preset.id)) {
      throw new Error(`company_metadata.json recommendation_presets[${index}] requires a slug id and name`);
    }
    if (presetIds.has(preset.id)) throw new Error(`Duplicate recommendation preset id: ${preset.id}`);
    presetIds.add(preset.id);
  }
  for (const [index, company] of value.companies.entries()) {
    if (!company?.id || !company?.name) throw new Error(`company_metadata.json companies[${index}] requires id and name`);
    if (company.id !== companySlug(company.id)) throw new Error(`Invalid canonical company id: ${company.id}`);
    if (ids.has(company.id)) throw new Error(`Duplicate canonical company id: ${company.id}`);
    ids.add(company.id);
    for (const name of [company.name, ...(company.aliases ?? [])]) {
      const key = normalizeCompanyName(name).toLowerCase();
      if (names.has(key)) throw new Error(`Duplicate company metadata name or alias: ${name}`);
      names.add(key);
    }
  }
  for (const company of value.companies) {
    if (company.parent_id && !ids.has(company.parent_id)) throw new Error(`Unknown parent company id: ${company.parent_id}`);
    if (company.parent_id === company.id) throw new Error(`Company cannot be its own parent: ${company.id}`);
    for (const group of company.groups ?? []) {
      if (!presetIds.has(group)) throw new Error(`Unknown recommendation group ${group} on company ${company.id}`);
    }
  }
  for (const presetId of presetIds) {
    if (!value.companies.some((company) => (company.groups ?? []).includes(presetId))) {
      throw new Error(`Recommendation preset has no companies: ${presetId}`);
    }
  }
  const parentById = new Map(value.companies.map((company) => [company.id, company.parent_id ?? null]));
  for (const company of value.companies) {
    const seen = new Set([company.id]);
    let parentId = company.parent_id ?? null;
    while (parentId) {
      if (seen.has(parentId)) throw new Error(`Company parent cycle includes ${company.id}`);
      seen.add(parentId);
      parentId = parentById.get(parentId) ?? null;
    }
  }
  metadata = value;
  byName = new Map();
  byId = new Map(value.companies.map((company) => [company.id, company]));
  presetById = new Map(presets.map((preset) => [preset.id, preset]));
  coverageByName = new Map((Array.isArray(targets) ? targets : []).map((target) => [
    normalizeCompanyName(target.company).toLowerCase(),
    coverageDisciplinesFor(target),
  ]));
  for (const company of value.companies) {
    for (const name of [company.name, ...(company.aliases ?? [])]) {
      byName.set(normalizeCompanyName(name).toLowerCase(), company);
    }
  }
}

export function companyDetails(value) {
  const normalizedName = normalizeCompanyName(value);
  const configured = byName.get(normalizedName.toLowerCase());
  const groups = configured?.groups ?? [];
  const featuredDisciplines = [...new Set(groups
    .map((group) => presetById.get(group)?.discipline)
    .filter(Boolean))];
  const coverageDisciplines = coverageByName.get(normalizedName.toLowerCase()) ?? [];
  return configured
    ? {
        ...configured,
        aliases: configured.aliases ?? [],
        groups,
        coverage_disciplines: coverageDisciplines,
        featured_disciplines: featuredDisciplines,
        featured: featuredDisciplines.length > 0,
      }
    : {
        id: companySlug(normalizedName),
        name: normalizedName,
        aliases: [],
        groups: [],
        coverage_disciplines: coverageDisciplines,
        featured_disciplines: [],
        featured: false,
      };
}

export function companyById(id) {
  return byId.get(id) ?? null;
}

export function featuredLegend() {
  return metadata.featured_legend || "Standout employers are curated separately for each discipline; this is not a universal company ranking.";
}

export function publicCompanyCatalog(targets) {
  const companies = new Map();
  for (const target of targets) {
    const details = companyDetails(target.company);
    if (!details.id) throw new Error(`Cannot generate a company id for ${target.company}`);
    if (companies.has(details.id)) throw new Error(`Duplicate company id in source registry: ${details.id}`);
    companies.set(details.id, {
      id: details.id,
      name: details.name,
      parent_id: details.parent_id ?? null,
      featured: details.featured,
      featured_disciplines: details.featured_disciplines,
      coverage_disciplines: details.coverage_disciplines,
      groups: details.groups,
      bucket: target.bucket ?? "",
      role_families: String(target.role_families ?? "").split(",").map((value) => value.trim()).filter(Boolean),
    });
  }
  for (const company of companies.values()) {
    if (company.parent_id && !companies.has(company.parent_id)) {
      throw new Error(`Company catalog is missing parent ${company.parent_id} for ${company.id}`);
    }
  }
  return {
    version: Number(metadata.version) || 1,
    generated_at: new Date().toISOString(),
    featured_legend: featuredLegend(),
    companies: [...companies.values()].sort((a, b) => Number(b.featured) - Number(a.featured) || a.name.localeCompare(b.name)),
    recommendation_presets: (metadata.recommendation_presets ?? []).map((preset) => ({
      ...preset,
      company_ids: [...companies.values()].filter((company) => company.groups.includes(preset.id)).map((company) => company.id),
    })),
  };
}
