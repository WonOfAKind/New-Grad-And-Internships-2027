import {
  atsSourceConcurrency,
  doubleCheckErrors,
  doubleCheckTimeoutMs,
  fetchTimeoutMs,
} from "../config.mjs";
import { mapConcurrent } from "../domain.mjs";
import { isRetryableScanError, sourceErrorLog } from "../http.mjs";
import {
  scanAshby,
  scanAvature,
  scanGreenhouse,
  scanLever,
  scanPhenom,
  scanTesla,
  scanWorkday,
} from "./providers.mjs";
import { scanGoogleCareers, scanHtmlJobs, scanSitemapJobs } from "./html.mjs";

export async function scanSource(source, timeoutMs) {
  switch (source.adapter) {
    case "greenhouse": return scanGreenhouse(source, timeoutMs);
    case "lever": return scanLever(source, timeoutMs);
    case "ashby": return scanAshby(source, timeoutMs);
    case "workday": return scanWorkday(source, timeoutMs);
    case "phenom": return scanPhenom(source, timeoutMs);
    case "avature": return scanAvature(source, timeoutMs);
    case "tesla": return scanTesla(source, timeoutMs);
    case "html_jobs": return scanHtmlJobs(source, timeoutMs);
    case "google_careers": return scanGoogleCareers(source, timeoutMs);
    case "sitemap_jobs": return scanSitemapJobs(source, timeoutMs);
    default: throw new Error(`Unsupported adapter: ${source.adapter}`);
  }
}

export async function scanAtsSource(source) {
    const sourceTimeoutMs = source.timeoutMs ?? fetchTimeoutMs;
    try {
      const leads = await scanSource(source, sourceTimeoutMs);
      return {
        leads,
        log: { company: source.company, adapter: source.adapter, source_kind: source.source_kind ?? "configured", status: "ok", matches: leads.length, phase: "fast-pass" },
      };
    } catch (error) {
      const initialError = error.message;
      if (!doubleCheckErrors || !isRetryableScanError(initialError)) {
        return {
          leads: [],
          log: sourceErrorLog(source, initialError, "fast-pass"),
        };
      }

      try {
        const retryTimeoutMs = source.doubleCheckTimeoutMs ?? doubleCheckTimeoutMs;
        const leads = await scanSource(source, retryTimeoutMs);
        return {
          leads,
          log: [
            sourceErrorLog(source, initialError, "fast-pass"),
            { company: source.company, adapter: source.adapter, source_kind: source.source_kind ?? "configured", status: "ok", matches: leads.length, phase: "double-check" },
          ],
        };
      } catch (retryError) {
        return {
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

