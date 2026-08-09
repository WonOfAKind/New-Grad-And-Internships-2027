import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const apiUrl = String(process.env.NOTIFICATION_API_URL ?? "").trim();
const ingestSecret = String(process.env.NOTIFICATION_INGEST_SECRET ?? "").trim();

if (!apiUrl || !ingestSecret) {
  console.log("Notification dispatch is not configured; skipping.");
  process.exit(0);
}
if (!/^https:\/\//i.test(apiUrl)) throw new Error("NOTIFICATION_API_URL must be an HTTPS URL");

const outbox = JSON.parse(await fs.readFile(path.join(rootDir, "data", "notification_outbox.json"), "utf8"));
if (!Array.isArray(outbox.roles) || !Array.isArray(outbox.companies) || !outbox.scan_id) {
  throw new Error("data/notification_outbox.json is invalid");
}

let lastError;
for (let attempt = 1; attempt <= 3; attempt += 1) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);
  try {
    const response = await fetch(apiUrl, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "x-ingest-secret": ingestSecret,
      },
      body: JSON.stringify(outbox),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || `Notification API returned ${response.status}`);
    console.log(JSON.stringify({
      scan_id: result.scan_id ?? outbox.scan_id,
      roles: result.roles ?? outbox.roles.length,
      recipients: result.recipients ?? 0,
      sent: result.sent ?? 0,
      failures: result.failures ?? 0,
    }, null, 2));
    process.exit(0);
  } catch (error) {
    lastError = error;
    if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
  } finally {
    clearTimeout(timeout);
  }
}
throw lastError;
