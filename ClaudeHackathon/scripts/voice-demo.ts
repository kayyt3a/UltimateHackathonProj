/**
 * Makes one real Voice call and prints the briefing plus the honesty audit.
 *
 *   npm run voice:demo                       # the red water case (escalation ALLOWED)
 *   npm run voice:demo -- 2026-07-10T06:00:00Z   # red ventilation (escalation FORBIDDEN)
 *
 * Requires ANTHROPIC_API_KEY (or an `ant auth login` profile).
 */
import { aggregate } from "../lib/aggregate";
import { rulePredictedEscalation, ruleScope, disputedLedgerEntries } from "../lib/escalation";
import { readCurrentLedger } from "../lib/ledger-reader";
import { getWatchers } from "../lib/watcher-adapter";
import { buildVoicePrompt, voice, VOICE_MODEL } from "../lib/voice";
import { estimateCostUsd } from "../lib/cost";

async function main() {
  const ts = process.argv[2] ?? "2026-07-05T04:00:00Z";
  const bundle = await getWatchers(ts);
  const ledger = await readCurrentLedger();
  const severity = aggregate(bundle.watchers);

  console.log(`timestamp : ${ts}`);
  console.log(`severity  : ${severity}   (computed by code, never by the model)`);
  console.log(`scope     : ${ruleScope(bundle.watchers).reason}`);
  const ruling = rulePredictedEscalation(bundle.watchers);
  console.log(`escalation: ${ruling.allowed ? "ALLOWED" : "NOT ALLOWED"} — ${ruling.reason}`);
  const disputed = disputedLedgerEntries(bundle.watchers, ledger);
  console.log(`disputed  : ${disputed.length > 0 ? disputed.map((d) => d.id).join(", ") : "none relevant"}`);

  if (severity === "green") {
    console.log("\nSeverity is green — the Voice agent does not run. Nothing to show.");
    return;
  }

  if (process.argv.includes("--print-prompt")) {
    console.log("\n--- PROMPT ---\n");
    console.log(buildVoicePrompt(bundle, ledger));
    console.log("\n--- END PROMPT ---\n");
  }

  console.log(`\nCalling ${VOICE_MODEL}...\n`);
  const result = await voice(bundle, ledger);

  console.log(JSON.stringify(result.diagnosis, null, 2));
  console.log(
    `\ntokens: ${result.tokens_used} (in ${result.input_tokens} / out ${result.output_tokens})  cost: $${estimateCostUsd(
      result.model,
      result.input_tokens,
      result.output_tokens,
    ).toFixed(6)}`,
  );

  if (result.warnings.length === 0) {
    console.log("\nHonesty audit: clean — no guardrail had to overrule the model.");
  } else {
    console.log("\nHonesty audit: guardrails fired —");
    for (const w of result.warnings) console.log(`  ! ${w}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
