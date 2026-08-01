// Runs the Reconciliation Agent once per Cloudy entry (5 calls) to seed
// data/knowledge_ledger.json. Order matters: 1, 3, 4, 5 land first so that
// when Entry 2 runs last, the agent has real ledger entries to compare
// against and can flag it as redundant rather than novel.
//
// This is a real eval, not a smoke test — it checks the agent reproduces the
// expected verdicts from the project brief before calling seeding done.
// Run with `npm run seed:ledger` (requires ANTHROPIC_API_KEY).

// Must come first — populates process.env before the Anthropic client is built.
import { describeKeyProblem } from "./load-env";
import { reconcileClaim } from "../lib/reconcile";
import { getStatsForClaim } from "../lib/stats";
import { writeLedger } from "../lib/ledger";
import { LedgerRow, Verdict } from "../lib/types";

interface CloudyNote {
  id: string;
  statsKey: string;
  label: string;
  text: string;
  expectedVerdicts: Verdict[];
}

// Verbatim from cloudys_logs.md. Do not paraphrase — the whole exercise is
// testing what Cloudy actually wrote, not a tidied-up restatement of it.
const CLOUDY_NOTES: CloudyNote[] = [
  {
    id: "entry_1",
    statsKey: "entry_1",
    label: "Cloudy's notes — Entry 1: The pipes are getting old",
    text: `The water system has always been a reliable old friend, but I have noticed something strange. The valves rarely fail without warning. The pipes seem to complain first.

A small drop in pressure here. A weaker flow there.

The younger dragons keep asking why I check the pressure gauge so often. They think I am being overly cautious.

They will understand someday.

Note to self: check the pressure readings before trusting the valves.`,
    expectedVerdicts: ["supported"],
  },
  {
    id: "entry_3",
    statsKey: "entry_3",
    label: "Cloudy's notes — Entry 3: The fans are working harder",
    text: `Something is wrong with the ventilation system.

When the system is healthy, there is a linear relationship between power and airflow.
Any deviation from this indicates poor health.

It is almost as if the machines are running in circles — working harder but achieving less.

I have checked the power readings twice now. The numbers are telling a story, but I have not yet found the right way to read it.`,
    expectedVerdicts: ["supported"],
  },
  {
    id: "entry_4",
    statsKey: "entry_4",
    label: "Cloudy's notes — Entry 4: A cold night reminder",
    text: `The shelter depends on the ventilation system more than most dragons realise.

When airflow drops, the temperature does not immediately change. The cold arrives later.

Anyone watching only the temperature will notice the problem too late.

The first signs are elsewhere.`,
    expectedVerdicts: ["refuted"],
  },
  {
    id: "entry_5",
    statsKey: "entry_5",
    label: "Cloudy's notes — Entry 5: Missing pieces",
    text: `The Giant Peacock damaged more than just the machines.

Some sensors now go silent without warning.

Do not assume an empty space means nothing happened.

Sometimes missing information is itself a clue.`,
    // Notebook records this as UNSUPPORTED: 6 gaps, scattered, no clustering.
    // "refuted" is the closest verdict; "untestable" is defensible on n=6.
    expectedVerdicts: ["refuted", "untestable"],
  },
  {
    id: "entry_2",
    statsKey: "entry_2",
    label: "Cloudy's notes — Entry 2: The library has a rhythm",
    text: `Every machine has its own voice.

The ventilation fans have a steady hum when they are happy. When they are struggling, the sound changes.

A little vibration. A different pitch. A rattle that was not there yesterday.

The dragons who listen to the machinery may not understand the engineering, but they notice things that sensors sometimes miss.

Perhaps both should be listened to.`,
    // Nuanced: the sound DOES track system health (so the descriptive claim
    // holds), but "notice things that sensors miss" does not — sound is a
    // redescription of system_status, recorded at the same hour. Either
    // verdict is defensible provided note_to_dragons captures "true, but it
    // tells you nothing the sensors didn't already say."
    expectedVerdicts: ["supported", "refuted"],
  },
];

async function main() {
  // Fail fast with an actionable message instead of a raw SDK auth stack trace.
  const keyProblem = describeKeyProblem();
  if (keyProblem) {
    console.error(`\n${keyProblem}`);
    process.exitCode = 1;
    return;
  }

  const ledger: LedgerRow[] = [];
  const evalResults: { id: string; verdict: Verdict; expected: Verdict[]; pass: boolean }[] = [];

  for (const note of CLOUDY_NOTES) {
    console.log(`\nSeeding ${note.label}...`);
    const row = await reconcileClaim(
      note.id,
      note.label,
      note.text,
      getStatsForClaim(note.statsKey),
      ledger
    );
    console.log(JSON.stringify(row, null, 2));

    ledger.push(row);
    await writeLedger(ledger);

    const pass = note.expectedVerdicts.includes(row.verdict);
    evalResults.push({ id: note.id, verdict: row.verdict, expected: note.expectedVerdicts, pass });
  }

  console.log(`\nWrote ${ledger.length} rows to data/knowledge_ledger.json`);

  console.log("\n--- Eval: verdicts vs. expected ---");
  let allPass = true;
  for (const r of evalResults) {
    if (!r.pass) allPass = false;
    console.log(
      `${r.pass ? "PASS" : "FAIL"} ${r.id}: got "${r.verdict}", expected one of [${r.expected.join(", ")}]`
    );
  }

  const entry2Row = ledger.find((r) => r.id === "entry_2");
  const entry2FlagsRedundant =
    !!entry2Row &&
    /redundant|nothing new|no new|same time|already|confirms/i.test(
      `${entry2Row.evidence} ${entry2Row.note_to_dragons}`
    );
  console.log(
    `${entry2FlagsRedundant ? "PASS" : "CHECK MANUALLY"} entry_2 flags itself as redundant/no-new-info in evidence or note_to_dragons`
  );

  console.log(`\n${allPass ? "ALL VERDICTS MATCH EXPECTATIONS" : "SOME VERDICTS DID NOT MATCH — review above"}`);
  // process.exitCode, not process.exit() — exiting while sockets are mid-close
  // trips a libuv assertion on Windows.
  process.exitCode = allPass ? 0 : 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
