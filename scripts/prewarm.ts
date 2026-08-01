/**
 * Pre-warms the local response cache for the demo timestamps.
 *
 *   npm run prewarm                       # all four demo timestamps
 *   npm run prewarm -- 2026-07-05T04:00:00Z
 *
 * Requires ANTHROPIC_API_KEY (or an `ant auth login` profile) for the amber/red
 * timestamps, which make a real Voice call. The green timestamp needs no key —
 * severity is computed by code and no Voice call is made.
 *
 * Without credentials the amber/red entries are still written so Person D has
 * the exact response shape, but with `diagnosis: null` and a warning saying so.
 * They are never filled with an invented diagnosis.
 */
import { DEMO_TIMESTAMPS, cachePath, writeCache } from "../lib/cache";
import { diagnose } from "../lib/diagnose";
import { isUsingFixture } from "../lib/watchers";

async function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("-"));
  const timestamps = args.length > 0 ? args : [...DEMO_TIMESTAMPS];

  let realDiagnoses = 0;
  let placeholders = 0;

  for (const ts of timestamps) {
    process.stdout.write(`\n${ts}\n`);
    const response = await diagnose(ts);

    process.stdout.write(`  severity           : ${response.severity}\n`);
    process.stdout.write(
      `  diagnosis          : ${response.diagnosis ? `"${response.diagnosis.headline}"` : "null"}\n`,
    );
    if (response.diagnosis) {
      process.stdout.write(
        `  predicted_to_escalate: ${response.diagnosis.predicted_to_escalate}\n`,
      );
    }
    process.stdout.write(
      `  tokens / cost      : ${response.tokens_used} tok, $${response.estimated_cost_usd.toFixed(6)}\n`,
    );
    for (const w of response.warnings ?? []) {
      process.stdout.write(`  ! ${w}\n`);
    }

    if (response.severity !== "green" && !response.diagnosis) {
      // The Voice call could not run. Write the shape anyway so the demo has a
      // cache entry, and make it obvious that nothing was invented.
      await writeCache(ts, response);
      placeholders += 1;
    } else if (response.diagnosis) {
      realDiagnoses += 1;
    }

    process.stdout.write(`  cached at          : ${cachePath(ts)}\n`);
  }

  process.stdout.write(
    `\nDone. ${realDiagnoses} live diagnosis file(s), ${placeholders} shape-only placeholder(s).\n`,
  );
  if (isUsingFixture()) {
    process.stdout.write(
      "Watchers came from lib/fixtures/watchers.ts — drop in lib/watchers-impl.ts when Person B lands.\n",
    );
  }
  if (placeholders > 0) {
    process.stdout.write(
      "Placeholders have diagnosis: null. Set ANTHROPIC_API_KEY and re-run to fill them with real Voice output.\n",
    );
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
