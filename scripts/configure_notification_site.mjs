import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const configPath = path.join(rootDir, "docs", "notifications", "config.js");
const apiUrl = String(process.env.NOTIFICATION_PUBLIC_API_URL ?? "").trim();
const turnstileSiteKey = String(process.env.TURNSTILE_SITE_KEY ?? "").trim();

const config = `// Generated during the GitHub Pages deployment. Public values only.
window.JOB_ALERT_CONFIG = {
  apiUrl: ${JSON.stringify(apiUrl)},
  turnstileSiteKey: ${JSON.stringify(turnstileSiteKey)}
};
`;

await fs.writeFile(configPath, config, "utf8");
