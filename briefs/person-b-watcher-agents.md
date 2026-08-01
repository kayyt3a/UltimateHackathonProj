# Person B — Deterministic Watchers + Reconciliation Agent

Paste everything below into a fresh Claude Code session.

---

PROJECT: "Cloudy's Second Opinion" — Reid Library's late engineer Cloudy left 5
handwritten notes describing failure patterns; nobody ever connected them to
his sensor data. We tested every note against the real CSV — three of five
were wrong or misleading. Our job now has two halves: cheap, instant detection
for the five patterns, and a language-model agent that can test ANY claim
(Cloudy's or a brand-new document) against the data and against everything
already verified.

Stack: Next.js (App Router) + TypeScript, Claude API.

I AM PERSON B. **Important change from earlier plans: the five watchers are
NOT separate LLM calls.** Asking a model whether `-9.4 < -5` is slow, costs
money, and can hallucinate — and it would make the replay scrubber impossible
(dragging across 500 hours would fire thousands of LLM calls). The five
watchers are plain deterministic code. My actual AI work is the
**Reconciliation Agent** — a single, generalisable prompt that turns any
prose claim into a tested verdict, run offline for Cloudy's five notes and
live, on demand, for whatever the organizers or judges hand us. That live
capability is the direct answer to the guaranteed judging question about
disagreeing sources — see CLAUDE.md's "actual judging question" section.

=== PART 1: DETERMINISTIC WATCHERS (/lib/watchers.ts) — plain code, no LLM ===

MY INPUT — Person A exports getWindow(timestamp) returning:
```json
{
  "records": [ { "timestamp": "2026-07-05T06:00:00Z", "power_kw": 47.04,
    "airflow_m3s": 4.38, "airflow_corrected": 4.38,
    "water_pressure_kpa": 291.351, "water_flow_lps": 1.732,
    "temperature_c": 18.677, "vibration_level": 0.33, "sound_event": "hum",
    "system_status": "warning", "sensor_source": "original",
    "is_gap_filled": false, "residual": -0.021, "pressure_slope_6h": -9.4 } ],
  "baseline": { "residual": {"mean": 0.0, "std": 0.0006},
    "water_pressure_kpa": {"mean": 348, "std": 12.4},
    "vibration_level": {"mean": 0.15, "std": 0.032} }
}
```
Until their code lands, hardcode a fixture in this shape.

THE FOUR ACTIVE WATCHERS (Entry 2 is deliberately excluded — see below):

Entry 1 — pipes complain first. SUPPORTED.
  Rule: `pressure_slope_6h < -5` sustained for 3 consecutive hours →
  "firing" on the water subsystem. A milder decline (slope negative but not
  sustained past threshold) → "watching". Otherwise "quiet".

Entry 3 — fans running in circles. SUPPORTED, strongest signal.
  Rule: `residual < -0.5` → "firing" on the ventilation subsystem. Use the
  residual, NOT a power/airflow ratio — the residual's healthy band is ~200x
  tighter, confirmed by Person A's regression analysis.

Entry 4 — cold arrives later. REFUTED — and the watcher's job flips
  accordingly. Instead of confirming a lag that doesn't exist, this watcher
  checks in real time whether temperature_c moves in the SAME hour as
  residual/pressure_slope degradation (lag ≈ 0, per Person A's analysis) and
  reports that plainly: status "firing" here doesn't mean "danger," it means
  "temperature just proved it is NOT an early warning signal for this event" —
  render this distinctly in the UI (Person D), not as a red-alarm color.

Entry 5 — missing pieces. Repurposed as a DATA-INTEGRITY watcher (the literal
  "gaps are informative" claim didn't survive testing — see Person A's
  missingness analysis). Rule: check is_gap_filled and sensor_source in the
  window; "firing" if sensor_source is barry_j_ and there's any reason to
  suspect the calibration correction wasn't applied upstream, or if gaps are
  clustering unusually. In practice, for the demo, this watcher mostly reports
  "quiet" with an informational note about calibration status — it exists to
  honor the note's real point (sensor trustworthiness) without overclaiming.

Entry 2 — the library has a rhythm. EXCLUDED FROM SEVERITY. Person A's
  analysis shows sound_event maps 1:1 onto system_status — using it as a
  detector is leakage (reading the ground-truth label). Compute it anyway, but
  expose it SEPARATELY as `listener_validation`, not inside the `watchers`
  array that feeds the aggregator:
```json
{ "entry": "Entry 2", "accuracy_vs_system_status": 1.0,
  "note": "The young dragons' ears are exactly as accurate as the sensors — never earlier, never later." }
```

WATCHER OUTPUT SHAPE — locked, Person C's aggregator consumes the `watchers`
array (4 entries: 1, 3, 4, 5), and separately reads `listener_validation`:
```json
{
  "entry": "Entry 1",
  "status": "quiet" | "watching" | "firing",
  "subsystem": "water" | "ventilation" | null,
  "evidence": [
    { "hour": "2026-07-05T04:00:00Z", "signal": "pressure_slope_6h",
      "value": -9.4, "threshold": -5 }
  ],
  "reasoning": "Pressure has fallen at 9.4 kPa/h for the last 3 hours."
}
```
`reasoning` is a plain templated string (you write the template, not an LLM) —
e.g. `` `Pressure has fallen at ${Math.abs(slope).toFixed(1)} kPa/h for the last 3 hours.` ``.

checkAllWatchers(timestamp) returns `{ watchers: [...4], listener_validation }`.

=== PART 2: RECONCILIATION AGENT (/lib/reconcile.ts) — the real AI work ===

One prompt, used two ways: **offline**, run once over Cloudy's five notes to
seed the ledger; **live**, exposed via an endpoint that Person D's "new
information just arrived" text box calls directly. Same prompt both times —
only what's in `{note_text}` and how full `{existing_ledger}` is changes.

PROMPT:
```
You are checking a claim about Reid Library's systems against real sensor
data and everything already verified. The claim may come from Cloudy's
original handwritten logs, or from newly recovered maintenance records,
partial sensor logs, or repair notes. Treat every source the same way:
nothing is trusted just because of who wrote it or when it arrived.

NEW CLAIM SOURCE
{source_label}: {note_text}

COMPUTED STATISTICS RELEVANT TO THIS CLAIM
{precomputed_stats}

EVERYTHING ALREADY IN THE LEDGER
{existing_ledger_json}

Do not calculate anything yourself. Use the statistics exactly as given.

Steps:
1. State the claim plainly and testably.
2. Check it against the computed statistics.
3. Check it against every existing ledger entry for the same subsystem or
   signal. Does this claim agree, extend, or contradict something already
   verified?

Return JSON only:
{
  "claim": "the source's assertion, stated plainly and testably",
  "verdict": "supported" | "refuted" | "untestable" | "disputed",
  "evidence": "the specific statistic that decides it, quoted with its value",
  "conflicts_with": "id of the ledger entry it disagrees with, or null",
  "data_leans_toward": "which claim the evidence favours if disputed, or null",
  "operational_rule": "the rule to run live, or null if none",
  "note_to_dragons": "one sentence a non-technical dragon would understand"
}

Rules:
- If the data cannot decide the claim, say "untestable" — do not guess.
  Sample size is a legitimate reason for "untestable".
- If this claim contradicts an existing ledger entry AND the data doesn't
  clearly settle which is right, say "disputed" — do not silently prefer the
  newer source. Newer is not more correct.
- If this claim contradicts an existing ledger entry AND the data DOES
  clearly settle it, say "supported" or "refuted" as appropriate, but still
  fill in "conflicts_with" so the disagreement stays visible in the ledger.
```

PRECOMPUTED STATS to pass in — pull the exact numbers from Person A's
notebook: the regression R² and residual values, the pressure-slope escalation
rule and its n=2 validation, the sound/system_status confusion matrix, the
onset-test result, the missingness counts.

SEED THE LEDGER offline: run this prompt once per Cloudy entry (5 calls),
save results to `knowledge_ledger.json`. Expected verdicts (confirm the agent
reproduces these — this is a real eval, do it before moving on):
Entry 1 → supported, Entry 3 → supported, Entry 4 → refuted, Entry 5 →
untestable (or a qualified refuted-as-stated), Entry 2 → supported-but-flag-
as-redundant (note this one is nuanced — make sure `note_to_dragons` captures
"true but tells you nothing new").

LEDGER ROW SHAPE — locked, this is what Person D's ledger panel renders:
```json
{
  "id": "entry_1",
  "source_label": "Cloudy's notes — Entry 1",
  "claim": "...", "verdict": "supported",
  "evidence": "...", "conflicts_with": null, "data_leans_toward": null,
  "operational_rule": "pressure_slope_6h < -5 sustained 3h",
  "note_to_dragons": "...",
  "timestamp_added": "2026-08-01T09:00:00Z"
}
```

=== PART 3: LIVE ENDPOINT — /app/api/reconcile/route.ts ===
```
POST { "source_label": "Archived repair note (submitted live)", "text": "..." }
-> runs the Reconciliation Agent prompt against current ledger + stats
-> appends the returned row to knowledge_ledger.json with a fresh id/timestamp
-> returns the new row
```
Person D's live-ingest text box calls this directly. Coordinate with them on
the request/response shape above before they start — you own this contract.

REHEARSAL DOCUMENT — write one now, don't let the first live run happen in
front of judges: a fictional "unfinished repair note" claiming *"airflow
sensor recalibrated in March, nonlinear response expected above 50kW"* — this
directly threatens Entry 3. The regression holds to r²=0.999999 with no bend
above 50kW, so the agent should return `refuted`, `conflicts_with: "entry_3"`,
citing residual values above 50kW as evidence. Also prepare one document that
CONFIRMS something, so the demo shows both outcomes.

DELIVERABLE: watchers.ts with the four active watchers + listener_validation,
tests against a calm fixture (all quiet) and the 2026-07-05 06:00 fixture
(Entry 1 firing, Entry 3 quiet); the Reconciliation Agent prompt, the seeded
knowledge_ledger.json with correct verdicts for all five entries, the live
/api/reconcile endpoint, and both rehearsal documents tested end-to-end.
