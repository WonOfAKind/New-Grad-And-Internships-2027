import path from "node:path";
import { fileURLToPath } from "node:url";

import { mapConcurrent } from "./monitor/domain.mjs";
import { readJson } from "./monitor/http.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const companySourcesPath = path.join(__dirname, "..", "data", "company_sources.json");
const concurrency = Math.max(1, Number(process.env.COMPANY_LINK_CONCURRENCY) || 6);
const timeoutMs = Math.max(1000, Number(process.env.COMPANY_LINK_TIMEOUT_MS) || 15000);
const restrictedStatuses = new Set([401, 403, 405, 406, 409, 425, 429, 451]);

function errorMessage(error) {
  const cause = error?.cause;
  return [error?.name, error?.message, cause?.code, cause?.message]
    .filter(Boolean)
    .join(": ");
}

async function fetchCareerPage(target) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(target.career_url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        Accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
        "User-Agent": "Mozilla/5.0 (compatible; NewGradJobsLinkAudit/1.0)",
      },
    });
    await response.body?.cancel();
    const status = response.status;
    const classification = status >= 200 && status < 400
      ? "ok"
      : restrictedStatuses.has(status)
        ? "restricted"
        : status === 404 || status === 410
          ? "broken"
          : "error";
    return {
      company: target.company,
      career_url: target.career_url,
      resolved_url: response.url,
      status,
      classification,
    };
  } catch (error) {
    return {
      company: target.company,
      career_url: target.career_url,
      resolved_url: "",
      status: 0,
      classification: "error",
      error: errorMessage(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function checkCareerPage(target) {
  let result = await fetchCareerPage(target);
  // DNS and TLS failures can be transient when hundreds of unrelated hosts
  // are checked together. Retry them at the lower global concurrency before
  // reporting a company as inaccessible.
  for (let attempt = 1; result.classification === "error" && result.status === 0 && attempt < 3; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
    result = await fetchCareerPage(target);
  }
  return result;
}

const targets = await readJson(companySourcesPath, []);
const results = await mapConcurrent(targets, concurrency, checkCareerPage);
const counts = Object.fromEntries(["ok", "restricted", "broken", "error"].map((status) => [
  status,
  results.filter((result) => result.classification === status).length,
]));

console.log(JSON.stringify({ checked: results.length, ...counts }, null, 2));
for (const result of results.filter((item) => item.classification !== "ok")) {
  console.log(JSON.stringify(result));
}

if (counts.broken > 0) process.exitCode = 1;
