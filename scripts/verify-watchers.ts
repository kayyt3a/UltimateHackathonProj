/**
 * Contract check for Person B's watcher layer.
 *
 *   npm run verify:watchers
 *
 * Run this after swapping `lib/watchers-impl.ts`. It calls checkAllWatchers for
 * every demo timestamp and reports whether the output is understood by the
 * severity aggregator and the honesty rules — including the failure that is
 * otherwise invisible: entry labels that do not match "Entry <n>", which
 * silently disarm the escalation rule and make a real fault look calm.
 *
 * Exit code 0 = safe to integrate. No API key required.
 */
import { aggregate, faultWatchers } from "../lib/aggregate";
import { DEMO_TIMESTAMPS } from "../lib/cache";
import { rulePredictedEscalation, ruleScope } from "../lib/escalation";
import { getWatchersChecked, isUsingFixture } from "../lib/watchers";

const EXPECTED_SEVERITY: Record<string, string> = {
  "2026-07-04T23:00:00Z": "green",
  "2026-07-05T04:00:00Z": "amber",
  "2026-07-05T06:00:00Z": "red",
  "2026-07-06T00:00:00Z": "red",
  "2026-07-10T06:00:00Z": "red",
};

async function main() {
  console.log(
    isUsingFixture()
      ? "Source: lib/fixtures/watchers.ts (fixture — Person B has not landed yet)\n"
      : "Source: Person B's checkAllWatchers via lib/watchers-impl.ts\n",
  );

  let problemCount = 0;
  let severityMismatches = 0;

  for (const ts of DEMO_TIMESTAMPS) {
    const { bundle, problems } = await getWatchersChecked(ts);
    const severity = aggregate(faultWatchers(bundle.watchers));
    const scope = ruleScope(bundle.watchers);
    const ruling = rulePredictedEscalation(bundle.watchers);

    const expected = EXPECTED_SEVERITY[ts];
    const severityOk = severity === expected;
    if (!severityOk) severityMismatches += 1;

    console.log(`${ts}`);
    console.log(`  watchers   : ${bundle.watchers.map((w) => `${w.entry}=${w.status}`).join(", ") || "(none)"}`);
    console.log(`  severity   : ${severity}${severityOk ? "" : `   <-- expected ${expected}`}`);
    console.log(`  scope      : ${scope.subsystem_scope} / ${scope.mode}`);
    console.log(`  escalation : ${ruling.allowed ? "ALLOWED" : "not allowed"}`);
    for (const p of problems) {
      console.log(`  PROBLEM    : ${p}`);
      problemCount += 1;
    }
    console.log();
  }

  if (problemCount === 0 && severityMismatches === 0) {
    console.log("Contract OK — severity, scope and escalation all resolve as expected.");
    return;
  }

  if (problemCount > 0) {
    console.log(`${problemCount} contract problem(s). The normaliser coerced around them in the safe`);
    console.log("direction, but fixing them at the source is better. Key requirements:");
    console.log('  - entry must match "Entry <n>" (Entry 1, Entry 3, Entry 4, Entry 5)');
    console.log('  - status must be one of "firing" | "watching" | "quiet"');
    console.log('  - subsystem must be "water" | "ventilation" | null');
    console.log("  - evidence[].signal must include \"pressure_slope\" for the Entry 1 water rule");
    console.log("  - listener_validation must be present (Entry 2, informational only)");
  }
  if (severityMismatches > 0) {
    console.log(
      `\n${severityMismatches} timestamp(s) produced an unexpected severity. If your scenarios differ from`,
    );
    console.log("the fixture's, update EXPECTED_SEVERITY in this script — otherwise this is a real bug.");
  }
  process.exitCode = 1;
}

main().catch((err) => {
  console.error("checkAllWatchers threw:", err);
  process.exit(1);
});
