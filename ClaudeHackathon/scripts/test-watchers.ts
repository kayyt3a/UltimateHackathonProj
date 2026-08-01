// Assertion harness for the deterministic watchers.
//
// Two halves:
//   1. Hand-built fixtures — pin the threshold logic to exact known inputs.
//   2. The real 500-row dataset — prove the watchers survive real data
//      (nulls, real episodes) and actually fire on the known incidents.
//
// Run with `npm.cmd run test:watchers`.

import { checkAllWatchers, checkWindow } from "../lib/watchers";
import { getWindow as getFixtureWindow, FIXTURE_TIMESTAMPS } from "../lib/fixtures";
import {
  loadAllRecords,
  getBaseline,
  getDerivedConstants,
  getTimestampRange,
  type SensorRecord,
} from "../lib/data";

const ALL_RECORDS: SensorRecord[] = loadAllRecords();
const BASELINE = getBaseline();
const DERIVED = getDerivedConstants();
const { min: FIRST_TIMESTAMP, max: LAST_TIMESTAMP } = getTimestampRange();

let failures = 0;

function assertEqual(label: string, actual: unknown, expected: unknown) {
  const pass = actual === expected;
  if (!pass) failures += 1;
  console.log(`${pass ? "PASS" : "FAIL"} ${label} (expected ${expected}, got ${actual})`);
}

function assert(label: string, condition: boolean, detail = "") {
  if (!condition) failures += 1;
  console.log(`${condition ? "PASS" : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
}

const fixture = (ts: string) => checkWindow(getFixtureWindow(ts), ts);

console.log("========== PART 1: hand-built fixtures ==========");

console.log(`\n--- Calm fixture: ${FIXTURE_TIMESTAMPS.calm} (expect all quiet) ---`);
for (const w of fixture(FIXTURE_TIMESTAMPS.calm).watchers) {
  assertEqual(`${w.entry} status`, w.status, "quiet");
}

console.log(`\n--- Entry 1 firing fixture: ${FIXTURE_TIMESTAMPS.entry1Firing} ---`);
const firing = fixture(FIXTURE_TIMESTAMPS.entry1Firing);
const f1 = firing.watchers.find((w) => w.entry === "Entry 1")!;
const f3 = firing.watchers.find((w) => w.entry === "Entry 3")!;
assertEqual("Entry 1 status", f1.status, "firing");
assertEqual("Entry 1 subsystem", f1.subsystem, "water");
assertEqual("Entry 3 status", f3.status, "quiet");
console.log("  Entry 1:", f1.reasoning);

console.log(`\n--- Gap-filled fixture: ${FIXTURE_TIMESTAMPS.gapFilledPressure} ---`);
const gap1 = fixture(FIXTURE_TIMESTAMPS.gapFilledPressure).watchers.find(
  (w) => w.entry === "Entry 1"
)!;
assertEqual("Entry 1 downgraded on interpolated data", gap1.status, "watching");

console.log("\n========== PART 2: the real 500-row dataset ==========");
console.log(`Records: ${ALL_RECORDS.length}, ${FIRST_TIMESTAMP} -> ${LAST_TIMESTAMP}`);

// Every hour must evaluate without throwing. This is the check that catches
// null pressure_slope_6h in the first 5 rows, and any other real-data shape
// the fixtures didn't anticipate.
let thrown = 0;
let firstError = "";
const statusCounts: Record<string, Record<string, number>> = {};
for (const r of ALL_RECORDS) {
  try {
    const report = checkAllWatchers(r.timestamp);
    for (const w of report.watchers) {
      statusCounts[w.entry] ??= { quiet: 0, watching: 0, firing: 0 };
      statusCounts[w.entry][w.status] += 1;
    }
  } catch (e) {
    thrown += 1;
    if (!firstError) firstError = `${r.timestamp}: ${(e as Error).message}`;
  }
}
assert(`All ${ALL_RECORDS.length} hours evaluate without throwing`, thrown === 0, firstError);

console.log("\nStatus counts across the whole month:");
for (const [entry, counts] of Object.entries(statusCounts)) {
  console.log(
    `  ${entry}: quiet=${counts.quiet} watching=${counts.watching} firing=${counts.firing}`
  );
}

// The first 5 rows have null pressure_slope_6h — Entry 1 must stay quiet and
// say why, rather than crashing or inventing a stable reading.
const early = checkAllWatchers(ALL_RECORDS[0].timestamp).watchers.find(
  (w) => w.entry === "Entry 1"
)!;
assertEqual("Entry 1 quiet on null slope (row 0)", early.status, "quiet");
assert(
  "Entry 1 explains the null rather than claiming stability",
  early.reasoning.includes("not yet defined"),
  early.reasoning
);

// Both water episodes escalated, per the notebook. Entry 1 should fire at some
// point inside each one.
const waterEpisodes = DERIVED.episodes.filter((e) => e.subsystem === "water");
for (const ep of waterEpisodes) {
  const hours = ALL_RECORDS.filter((r) => r.timestamp >= ep.start_ts && r.timestamp <= ep.end_ts);
  const fired = hours.some(
    (r) =>
      checkAllWatchers(r.timestamp).watchers.find((w) => w.entry === "Entry 1")!.status === "firing"
  );
  assert(`Entry 1 fires during water episode ${ep.start_ts}`, fired);
}

// Ventilation episodes should trip Entry 3's residual detector.
const ventEpisodes = DERIVED.episodes.filter((e) => e.subsystem === "ventilation");
for (const ep of ventEpisodes) {
  const hours = ALL_RECORDS.filter((r) => r.timestamp >= ep.start_ts && r.timestamp <= ep.end_ts);
  const fired = hours.some(
    (r) =>
      checkAllWatchers(r.timestamp).watchers.find((w) => w.entry === "Entry 3")!.status === "firing"
  );
  assert(`Entry 3 fires during ventilation episode ${ep.start_ts}`, fired);
}

// Entry 3 must NOT fire during calm stretches — no false positives on stable
// hours, which is the whole value of a 0.999999 regression.
const stableHours = ALL_RECORDS.filter((r) => r.system_status === "stable");
const falsePositives = stableHours.filter(
  (r) =>
    checkAllWatchers(r.timestamp).watchers.find((w) => w.entry === "Entry 3")!.status === "firing"
);
assert(
  `Entry 3 has zero false positives across ${stableHours.length} stable hours`,
  falsePositives.length === 0,
  `${falsePositives.length} false positives`
);

// listener_validation over the full month should land on the real 95.2%,
// not the 1.0 the brief claimed.
const listener = checkWindow({ records: ALL_RECORDS, baseline: BASELINE }, LAST_TIMESTAMP)
  .listener_validation;
console.log(`\nlistener_validation over all 500 rows: ${listener.accuracy_vs_system_status}`);
console.log(`  ${listener.note}`);
assertEqual(
  "listener_validation matches the notebook's 476/500",
  listener.accuracy_vs_system_status,
  0.952
);

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
process.exitCode = failures === 0 ? 0 : 1;
