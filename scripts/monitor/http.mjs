import fs from "node:fs/promises";

import {
  fetchRetries,
  fetchRetryBaseMs,
  fetchTimeoutMs,
  supportedAdapters,
  userAgent,
} from "./config.mjs";
import { normalize, sleep } from "./domain.mjs";

export async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

export function isHttpUrl(value) {
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

export function validateConfiguration(targets, sources) {
  if (!Array.isArray(targets)) throw new Error("data/company_sources.json must contain a JSON array");
  if (!Array.isArray(sources)) throw new Error("data/ats_sources.json must contain a JSON array");
  if (targets.length === 0) throw new Error("data/company_sources.json must contain at least one company");
  if (sources.length === 0) throw new Error("data/ats_sources.json must contain at least one source");

  const targetCompanies = new Set();
  for (const [index, target] of targets.entries()) {
    const label = `company_sources.json[${index}]`;
    if (!normalize(target?.company)) throw new Error(`${label}.company is required`);
    const companyKey = normalize(target.company).toLowerCase();
    if (targetCompanies.has(companyKey)) throw new Error(`Duplicate company target: ${target.company}`);
    targetCompanies.add(companyKey);
    if (!isHttpUrl(target.career_url)) throw new Error(`${label}.career_url must be an HTTP(S) URL`);
    if (!/^P[0-2]$/.test(normalize(target.priority))) throw new Error(`${label}.priority must be P0, P1, or P2`);
  }

  const requiredByAdapter = {
    greenhouse: ["board"],
    lever: ["site"],
    ashby: ["board"],
    workday: ["tenant", "site"],
    oracle: ["baseUrl", "siteNumber"],
    phenom: ["baseUrl"],
    avature: ["baseUrl"],
    tesla: ["url"],
    tiktok: ["baseUrl"],
    sitemap_jobs: ["sitemaps"],
  };
  const sourceKeys = new Set();
  for (const [index, source] of sources.entries()) {
    const label = `ats_sources.json[${index}]`;
    if (!normalize(source?.company)) throw new Error(`${label}.company is required`);
    if (!supportedAdapters.has(source.adapter)) throw new Error(`${label}.adapter is unsupported: ${source.adapter}`);
    if (source.priority != null && !/^P[0-2]$/.test(normalize(source.priority))) {
      throw new Error(`${label}.priority must be P0, P1, or P2`);
    }
    if (!targetCompanies.has(normalize(source.company).toLowerCase())) {
      throw new Error(`${label}.company is missing from company_sources.json: ${source.company}`);
    }
    const sourceKey = `${normalize(source.company).toLowerCase()}|${source.adapter}`;
    if (sourceKeys.has(sourceKey)) throw new Error(`Duplicate ATS source: ${source.company} (${source.adapter})`);
    sourceKeys.add(sourceKey);
    for (const field of requiredByAdapter[source.adapter] ?? []) {
      if (!normalize(source[field])) throw new Error(`${label}.${field} is required for ${source.adapter}`);
    }
    if (["phenom", "avature", "oracle", "tiktok"].includes(source.adapter) && !isHttpUrl(source.baseUrl)) {
      throw new Error(`${label}.baseUrl must be an HTTP(S) URL`);
    }
    if (source.adapter === "tesla" && !isHttpUrl(source.url)) {
      throw new Error(`${label}.url must be an HTTP(S) URL`);
    }
    if (["html_jobs", "google_careers"].includes(source.adapter)) {
      const urls = source.urls ?? (source.url ? [source.url] : []);
      if (!Array.isArray(urls) || urls.length === 0 || urls.some((url) => !isHttpUrl(url))) {
        throw new Error(`${label} must define at least one valid HTTP(S) url`);
      }
      for (const pattern of source.detailUrlPatterns ?? []) {
        try {
          new RegExp(pattern, "i");
        } catch (error) {
          throw new Error(`${label}.detailUrlPatterns contains an invalid regex: ${error.message}`);
        }
      }
    }
    if (source.adapter === "sitemap_jobs" && (!Array.isArray(source.sitemaps) || source.sitemaps.length === 0 || source.sitemaps.some((url) => !isHttpUrl(url)))) {
      throw new Error(`${label}.sitemaps must be a non-empty array of HTTP(S) URLs`);
    }
    if (source.searchTexts != null && (!Array.isArray(source.searchTexts) || source.searchTexts.length === 0 || source.searchTexts.some((value) => !normalize(value)))) {
      throw new Error(`${label}.searchTexts must be a non-empty array of strings`);
    }
    for (const field of ["timeoutMs", "doubleCheckTimeoutMs", "limit", "detailLimit", "maxPages"]) {
      if (source[field] != null && (!Number.isSafeInteger(source[field]) || source[field] <= 0)) {
        throw new Error(`${label}.${field} must be a positive integer`);
      }
    }
  }
}

export function retryAfterMs(response) {
  const value = response.headers.get("retry-after");
  if (!value) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 120000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? 0 : Math.min(Math.max(date - Date.now(), 0), 120000);
}

export async function fetchWithRetries(url, accept, readBody, timeoutMs = fetchTimeoutMs, init = {}) {
  let lastError;
  for (let attempt = 0; attempt <= fetchRetries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        ...init,
        signal: controller.signal,
        headers: {
          "User-Agent": userAgent,
          "Accept": accept,
          ...(init.headers ?? {}),
        },
      });
      if (!response.ok) {
        const error = new Error(`${response.status} ${response.statusText}`);
        error.retryable = response.status === 408 || response.status === 429 || response.status >= 500;
        error.retryAfterMs = retryAfterMs(response);
        throw error;
      }
      return await readBody(response);
    } catch (error) {
      lastError = error.name === "AbortError"
        ? Object.assign(new Error(`request timed out after ${timeoutMs}ms`), { retryable: true })
        : error;
      if (attempt >= fetchRetries || error.retryable === false) break;
      const jitter = fetchRetryBaseMs > 0 ? Math.floor(Math.random() * fetchRetryBaseMs) : 0;
      const retryDelayMs = Math.max(error.retryAfterMs ?? 0, fetchRetryBaseMs * (2 ** attempt) + jitter);
      await sleep(retryDelayMs);
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError;
}

export async function fetchJson(url, timeoutMs = fetchTimeoutMs) {
  return fetchWithRetries(url, "application/json,text/plain,*/*", (response) => response.json(), timeoutMs);
}

export async function fetchText(url, timeoutMs = fetchTimeoutMs, init = {}) {
  return fetchWithRetries(url, "text/html,text/plain,*/*", (response) => response.text(), timeoutMs, init);
}

export async function fetchDocument(url, timeoutMs = fetchTimeoutMs, init = {}) {
  return fetchWithRetries(url, "text/html,application/xhtml+xml,text/plain,*/*", async (response) => ({
    text: await response.text(),
    url: response.url,
    contentType: response.headers.get("content-type") ?? "",
  }), timeoutMs, init);
}

export function isRetryableScanError(errorMessage = "") {
  return /aborted|timeout|fetch failed|429|too many requests|econnreset|etimedout|socket/i.test(errorMessage);
}

export function sourceErrorStatus(source, errorMessage = "") {
  if (source.adapter === "tesla" && /401|403|406|429|451|forbidden|access denied|akamai|permission/i.test(errorMessage)) {
    return "blocked";
  }
  return "error";
}

export function sourceErrorLog(source, errorMessage, phase) {
  const status = sourceErrorStatus(source, errorMessage);
  const log = { company: source.company, adapter: source.adapter, source_kind: source.source_kind ?? "configured", status, error: errorMessage, phase };
  if (status === "blocked") {
    log.blocked_reason = "Tesla's official careers endpoint denied automated access from this runner; secondary discovery feeds can still surface direct Tesla job URLs for official-page verification.";
  }
  return log;
}
