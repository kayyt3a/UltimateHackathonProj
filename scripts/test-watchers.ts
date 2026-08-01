// Quick assertion harness for the deterministic watchers. Not a full test
// framework — just enough to prove the two required fixtures behave as
// specified before this ships. Run with `npm run test:watchers`.

import { checkAllWatchers } from "../lib/watchers-impl";
import { FIXTURE_TIMESTAMPS } from "../lib/sensor-window";

let failures = 0;

function assertEqual(label: string, actual: unknown, expected: unknown) {
  const pass = actual === expected;
  if (!pass) failures += 1;
  console.log(`${pass ? "PASS" : "FAIL"} ${label} (expected ${expected}, got ${actual})`);
}

console.log(`\n--- Calm fixture: ${FIXTURE_TIMESTAMPS.calm} (expect all quiet) ---`);
const calm = checkAllWatchers(FIXTURE_TIMESTAMPS.calm);
for (const w of calm.watchers) {
  assertEqual(`${w.entry} status`, w.status, "quiet");
}
console.log("listener_validation:", calm.listener_validation);

console.log(`\n--- Entry 1 firing fixture: ${FIXTURE_TIMESTAMPS.entry1Firing} ---`);
const firing = checkAllWatchers(FIXTURE_TIMESTAMPS.entry1Firing);
const entry1 = firing.watchers.find((w) => w.entry === "Entry 1")!;
const entry3 = firing.watchers.find((w) => w.entry === "Entry 3")!;
assertEqual("Entry 1 status", entry1.status, "firing");
assertEqual("Entry 1 subsystem", entry1.subsystem, "water");
assertEqual("Entry 3 status", entry3.status, "quiet");
console.log("Entry 1 reasoning:", entry1.reasoning);
console.log("Entry 3 reasoning:", entry3.reasoning);
console.log("Entry 4 (temp lag refutation):", firing.watchers.find((w) => w.entry === "Entry 4"));
console.log("Entry 5 (data integrity):", firing.watchers.find((w) => w.entry === "Entry 5"));
console.log("listener_validation:", firing.listener_validation);

console.log(`\n--- Entry 5 suspect-calibration fixture: ${FIXTURE_TIMESTAMPS.entry5Suspect} ---`);
const suspect = checkAllWatchers(FIXTURE_TIMESTAMPS.entry5Suspect);
const entry5 = suspect.watchers.find((w) => w.entry === "Entry 5")!;
assertEqual("Entry 5 status", entry5.status, "firing");
console.log("Entry 5 reasoning:", entry5.reasoning);

console.log(`\n--- Gap-filled pressure fixture: ${FIXTURE_TIMESTAMPS.gapFilledPressure} ---`);
const gapFilled = checkAllWatchers(FIXTURE_TIMESTAMPS.gapFilledPressure);
const gapEntry1 = gapFilled.watchers.find((w) => w.entry === "Entry 1")!;
assertEqual("Entry 1 held down to watching on interpolated data", gapEntry1.status, "watching");
console.log("Entry 1 reasoning:", gapEntry1.reasoning);

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
