import assert from "node:assert/strict";
import fs from "node:fs/promises";

// Exercise the actual github-script gate, including DST and delayed triggers.
const workflow = await fs.readFile(new URL("../.github/workflows/monitor.yml", import.meta.url), "utf8");
const script = workflow.match(/          script: \|\r?\n((?:            .*\r?\n)+)/)?.[1]
  .split(/\r?\n/).map((line) => line.slice(12)).join("\n");
assert.ok(script, "workflow must expose the window gate");
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const gate = new AsyncFunction("Date", "context", "core", script);
const cases = [
  ["2026-09-04T12:59:59Z", "schedule", false],
  ["2026-09-04T13:00:00Z", "schedule", true],
  ["2026-09-04T23:59:59Z", "schedule", true],
  ["2026-09-05T00:00:00Z", "schedule", false],
  ["2026-09-05T04:17:46Z", "schedule", false],
  ["2026-09-06T16:00:00Z", "schedule", false],
  ["2027-01-04T13:59:59Z", "schedule", false],
  ["2027-01-04T14:00:00Z", "schedule", true],
  ["2027-01-05T00:59:59Z", "schedule", true],
  ["2027-01-05T01:00:00Z", "schedule", false],
  ["2027-03-15T13:00:00Z", "schedule", true],
  ["2026-09-04T14:00:00Z", "repository_dispatch", true],
  ["2026-09-06T16:00:00Z", "repository_dispatch", false],
  ["2026-09-06T16:00:00Z", "workflow_dispatch", true],
];
for (const [date, eventName, expected] of cases) {
  const outputs = {};
  let wroteSummary = false;
  const summary = {
    addHeading() { return this; }, addTable() { return this; }, addRaw() { return this; },
    async write() { wroteSummary = true; },
  };
  class Clock extends Date { constructor() { super(date); } }
  await gate(Clock, { eventName }, { setOutput: (key, value) => { outputs[key] = value; }, info() {}, summary });
  assert.equal(outputs.run, String(expected), `${eventName} at ${date}`);
  assert.ok(wroteSummary, "every gate decision must explain whether a scan will run");
}
console.log(`workflow time-window checks ok (${cases.length} cases)`);
