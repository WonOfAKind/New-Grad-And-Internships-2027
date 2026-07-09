import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { discoverSources } from "./monitor/discovery.mjs";
import { readJson, validateConfiguration } from "./monitor/http.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = path.join(rootDir, "data");
const targetPath = path.join(dataDir, "company_sources.json");
const sourcePath = path.join(dataDir, "ats_sources.json");
const discoveryPath = path.join(dataDir, "source_discovery.json");

const targets = await readJson(targetPath, []);
const configuredSources = await readJson(sourcePath, []);
const previousState = await readJson(discoveryPath, { version: 3, companies: {} });
validateConfiguration(targets, configuredSources);

const discovery = await discoverSources(targets, configuredSources, previousState);
await fs.writeFile(discoveryPath, `${JSON.stringify(discovery.state, null, 2)}\n`, "utf8");

console.log(JSON.stringify({
  companies: targets.length,
  configured_sources: configuredSources.length,
  attempted: discovery.attempted,
  discovered_now: discovery.discovered_now,
  active_discovered_sources: discovery.sources.length,
  due_remaining: discovery.due_remaining,
  status_counts: discovery.status_counts,
}, null, 2));
