// Runs the Reconciliation Agent once per Cloudy entry (5 calls) to seed
// data/knowledge_ledger.json. Order matters: 1, 3, 4, 5 land first so that
// when Entry 2 runs last, the agent has real ledger entries to compare
// against and can flag it as redundant rather than novel.
//
// This is a real eval, not a smoke test — it checks the agent reproduces the
// expected verdicts from the project brief before calling seeding done.
// Run with `npm run seed:ledger` (requires ANTHROPIC_API_KEY).

import { reconcileClaim } from "../lib/reconcile";
import { getStatsForClaim } from "../lib/stats";
import { writeLedger } from "../lib/ledger-store";
import { LedgerRow, Verdict } from "../lib/types";

interface CloudyNote {
  id: string;
  statsKey: string;
  label: string;
  text: string;
  expectedVerdicts: Verdict[];
}

const CLOUDY_NOTES: CloudyNote[] = [
  {
    id: "entry_1",
    statsKey: "entry_1",
    label: "Cloudy's notes — Entry 1",
    text: "The pipes always complain before they break. Watch the water pressure — when it starts falling steady, not spiking, you've got hours before something gives.",
    expectedVerdicts: ["supported"],
  },
  {
    id: "entry_3",
    statsKey: "entry_3",
    label: "Cloudy's notes — Entry 3",
    text: "When the fans start running in circles — same power draw, less air moving — that's the ventilation system fighting something upstream. Catch it in the numbers before you hear it.",
    expectedVerdicts: ["supported"],
  },
  {
    id: "entry_4",
    statsKey: "entry_4",
    label: "Cloudy's notes — Entry 4",
    text: "Cold arrives later. By the time you feel it in the room, the machine's been struggling for hours — temperature is the last sign, not the first. Don't trust it as an early warning.",
    expectedVerdicts: ["refuted"],
  },
  {
    id: "entry_5",
    statsKey: "entry_5",
    label: "Cloudy's notes — Entry 5",
    text: "Missing pieces tell you something too. When a sensor drops out and comes back gap-filled, that's not nothing — the gaps themselves are trying to tell you the system's confused.",
    expectedVerdicts: ["untestable", "refuted"],
  },
  {
    id: "entry_2",
    statsKey: "entry_2",
    label: "Cloudy's notes — Entry 2",
    text: "The library has a rhythm you can hear before you can measure it. When the young ones get restless and the hum changes, trust their ears — they know something's wrong before the sensors log it.",
    expectedVerdicts: ["supported"],
  },
];

async function main() {
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
  process.exit(allPass ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
