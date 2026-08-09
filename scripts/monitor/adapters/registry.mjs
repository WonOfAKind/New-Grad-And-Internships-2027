import {
  atsSourceConcurrency,
  doubleCheckErrors,
  doubleCheckTimeoutMs,
  fetchTimeoutMs,
  sourceScanDeadlineMs,
} from "../config.mjs";
import { mapConcurrent } from "../domain.mjs";
import { isRetryableScanError, sourceErrorLog } from "../http.mjs";
import { annotateSourceLeads, reconciliationModeFor, sourceIdFor } from "../lifecycle.mjs";
import { scanAmazon } from "./amazon.mjs";
import { scanEightfold } from "./eightfold.mjs";
import {
  scanAshby,
  scanAvature,
  scanGreenhouse,
  scanLever,
  scanOracle,
  scanPhenom,
  scanTesla,
  scanTikTok,
  scanWorkday,
} from "./providers.mjs";
import { scanGoogleCareers, scanHtmlJobs, scanRssJobs, scanSitemapJobs } from "./html.mjs";

export async function scanSource(source, timeoutMs) {
  switch (source.adapter) {
    case "amazon": return scanAmazon(source, timeoutMs);
    case "eightfold": return scanEightfold(source, timeoutMs);
    case "greenhouse": return scanGreenhouse(source, timeoutMs);
    case "lever": return scanLever(source, timeoutMs);
    case "ashby": return scanAshby(source, timeoutMs);
    case "workday": return scanWorkday(source, timeoutMs);
    case "oracle": return scanOracle(source, timeoutMs);
    case "phenom": return scanPhenom(source, timeoutMs);
    case "avature": return scanAvature(source, timeoutMs);
    case "tesla": return scanTesla(source, timeoutMs);
    case "tiktok": return scanTikTok(source, timeoutMs);
    case "html_jobs": return scanHtmlJobs(source, timeoutMs);
    case "google_careers": return scanGoogleCareers(source, timeoutMs);
    case "sitemap_jobs": return scanSitemapJobs(source, timeoutMs);
    case "rss_jobs": return scanRssJobs(source, timeoutMs);
    default: throw new Error(`Unsupported adapter: ${source.adapter}`);
  }
}

export async function withScanDeadline(promise, timeoutMs, source) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${source.company} ${source.adapter} scan timed out after ${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function scanAtsSource(source) {
  const sourceTimeoutMs = source.timeoutMs ?? fetchTimeoutMs;
  const sourceMetadata = {
    source_id: sourceIdFor(source),
    reconciliation: reconciliationModeFor(source),
  };
  try {
      const leads = annotateSourceLeads(source, await withScanDeadline(
        scanSource(source, sourceTimeoutMs),
        source.scanDeadlineMs ?? sourceScanDeadlineMs,
        source,
      ));
      if (source.retryOnZero && leads.length === 0) {
        throw new Error(`${source.company} ${source.adapter} returned zero matches; retry requested`);
      }
      return {
        source,
        leads,
        log: { company: source.company, adapter: source.adapter, source_kind: source.source_kind ?? "configured", ...sourceMetadata, status: "ok", matches: leads.length, phase: "fast-pass" },
      };
    } catch (error) {
      const initialError = error.message;
      if (!doubleCheckErrors || (!isRetryableScanError(initialError) && !source.retryOnZero)) {
        return {
          source,
          leads: [],
          log: sourceErrorLog(source, initialError, "fast-pass"),
        };
      }

      try {
        const retryTimeoutMs = source.doubleCheckTimeoutMs ?? doubleCheckTimeoutMs;
        if (source.retryDelayMs) {
          await new Promise((resolve) => setTimeout(resolve, source.retryDelayMs));
        }
        const leads = annotateSourceLeads(source, await withScanDeadline(
          scanSource(source, retryTimeoutMs),
          source.doubleCheckDeadlineMs ?? Math.max(30000, retryTimeoutMs * 3),
          source,
        ));
        if (source.retryOnZero && leads.length === 0) {
          throw new Error(`${source.company} ${source.adapter} returned zero matches after retry`);
        }
        return {
          source,
          leads,
          log: [
            sourceErrorLog(source, initialError, "fast-pass"),
            { company: source.company, adapter: source.adapter, source_kind: source.source_kind ?? "configured", ...sourceMetadata, status: "ok", matches: leads.length, phase: "double-check" },
          ],
        };
      } catch (retryError) {
        return {
          source,
          leads: [],
          log: [
            sourceErrorLog(source, initialError, "fast-pass"),
            sourceErrorLog(source, retryError.message, "double-check"),
          ],
        };
      }
  }
}

export async function scanAtsSources(sources) {
  return mapConcurrent(sources, atsSourceConcurrency, scanAtsSource);
}
