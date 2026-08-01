# Person C — Aggregator, Voice Agent, API Route

Paste everything below into a fresh Claude Code session.

---

PROJECT: "Cloudy's Second Opinion" — a hackathon tool for dragons sheltering in
Reid Library after an attack damaged the building's power, water and ventilation
systems. Their late engineer Cloudy left 5 handwritten notes describing failure
patterns; nobody ever connected them to his sensor data. Five cheap AI agents each
watch one pattern; when one escalates, a larger "Voice" model speaks as Cloudy.

Stack: Next.js (App Router) + TypeScript, Claude API.

I AM PERSON C. I own three things: the deterministic severity aggregator, the
Voice agent, and the /api/diagnose route that ties the system together. I also
own conflict detection for the third organizer hint (see PART 4).

MY INPUT — Person B exports checkAllWatchers(timestamp) returning an array of 5:
```json
[
  { "entry": "Entry 1", "status": "firing", "confidence": "high",
    "conflict": false, "conflict_note": null,
    "evidence": [ { "hour": "2026-07-05T04:00:00Z",
      "signal": "water_pressure_kpa", "value": 314.4, "baseline": 348,
      "source": "sensor" } ],
    "reasoning": "Pressure fell for four straight hours while flow fell with it." },
  { "entry": "Entry 2", "status": "watching", "confidence": "high", "conflict": false, "conflict_note": null, "evidence": [], "reasoning": "..." },
  { "entry": "Entry 3", "status": "quiet", "confidence": "high", "conflict": false, "conflict_note": null, "evidence": [], "reasoning": "..." },
  { "entry": "Entry 4", "status": "quiet", "confidence": "high", "conflict": false, "conflict_note": null, "evidence": [], "reasoning": "..." },
  { "entry": "Entry 5", "status": "quiet", "confidence": "high", "conflict": false, "conflict_note": null, "evidence": [], "reasoning": "..." }
]
```
Until their code lands, hardcode fixtures in this shape and build against them.

=== PART 1: AGGREGATOR (/lib/aggregate.ts) — plain code, NO LLM call ===
```
any watcher "firing"  -> "red"
else any "watching"   -> "amber"
else                  -> "green"
```
Worst-of-five, never averaged. This is a deliberate design decision and a talking
point on stage: the traffic light must never hallucinate green during a real
emergency, so severity is computed from structured outputs by code. The model's
job is explaining WHY, never deciding HOW BAD.

=== PART 2: VOICE AGENT (/lib/voice.ts) ===
Runs ONLY when severity is amber or red — the one expensive call in the system,
use claude-sonnet-5. It receives all five watcher outputs (including the quiet
ones; absence is context) plus the full text of data/cloudys_logs.md.

Write the prompt so Cloudy:
 - speaks in first person, plain and slightly folksy, matching his real notes —
   never corporate, never "I have detected an anomaly"
 - cites actual numbers pulled from the evidence arrays. Vague output is a
   failure; our judging criteria demand specific values
 - names which of his own entries this is
 - recommends action scoped to ONLY the sick subsystem
 - keeps the quote under two sentences
 - if any watcher has conflict: true (see PART 4), explicitly narrates the
   disagreement instead of silently picking a side

Output shape — locked, Person D renders it:
```json
{
  "entry_cited": "Entry 1",
  "mode": "plumbing" | "ventilation" | "stable",
  "hours_to_failure_estimate": 6,
  "subsystem_scope": "water" | "ventilation",
  "recommended_action": "Shut the west valve manually before the gauge reads critical.",
  "cloudy_quote": "Pressure's slid from 348 to 291 in six hours and the flow went with it. Same shape as always — don't wait for the valve to tell you.",
  "confidence": "high" | "medium" | "low",
  "caveats": null
}
```

Mapping: Entry 1 or 2 firing -> mode "plumbing", subsystem_scope "water".
Entry 3 firing -> mode "ventilation", subsystem_scope "ventilation".
subsystem_scope carries real narrative weight: the shelter's two leaders are
deadlocked between running everything manually and keeping everything automated.
A scoped recommendation — shut the water, leave the fans running — dissolves that
argument without us building a separate feature for it.

For hours_to_failure_estimate, ground it in the lead-time analysis Person A is
producing from the historical incidents rather than letting the model invent a
number. Ask them for the figure and put it in the prompt as context.

=== PART 3: /app/api/diagnose/route.ts ===
```
GET ?ts=2026-07-05T06:00:00Z
-> watchers  = await checkAllWatchers(ts)
-> watchers  = detectConflicts(watchers)         // PART 4
-> severity  = aggregate(watchers)
-> diagnosis = severity === "green" ? null : await voice(watchers, notes)
-> sum token usage across every call this tick, estimate cost
-> write the full response to a local cache file keyed by timestamp
```

Response shape — locked, Person D builds against it:
```json
{
  "severity": "amber",
  "watchers": [ /* the five objects, passed through untouched */ ],
  "diagnosis": { /* voice output, or null when green */ },
  "tokens_used": 1850,
  "estimated_cost_usd": 0.0055
}
```

The cache is not optional — Person D falls back to it if a live call stalls on
stage. Pre-warm it for these four demo timestamps before we present:
2026-07-04T23:00, 2026-07-05T06:00, 2026-07-10T04:00, 2026-07-15T06:00.

=== PART 4: CONFLICT DETECTION (third organizer hint) ===
Context: the organizers say a newly powered-on section of the library may
surface archived maintenance records, partial old sensor logs, and unfinished
repair notes — and that this new information will sometimes contradict Cloudy's
notes, the live sensors, or the young dragons' observations. During judging
we'll be asked how our system handles disagreeing sources as new information
keeps arriving.

Right now there's only one evidence source ("sensor", from Person A/B), so there
is nothing to conflict with yet. Build detectConflicts(watchers) as a pass-
through function today: it takes the watcher array and returns it unchanged,
BUT it must already be structured so that adding a second evidence source later
(the archived-record data, once it exists) is a single new comparison step, not
a rewrite. Specifically:

```typescript
function detectConflicts(watchers: Watcher[]): Watcher[] {
  // Today: single source (sensor), nothing to compare against.
  // Later: if an evidence item exists with source "archived_record" that
  // contradicts a "sensor" evidence item for the same entry (e.g. opposite
  // trend direction, or a note claiming a component was already replaced),
  // set that watcher's conflict = true, conflict_note = a short description
  // of the disagreement, and confidence = "medium" or "low".
  return watchers;
}
```

This is what lets us answer the judges honestly: "our pipeline already tags
every piece of evidence with its source; conflict detection is a comparison
step that runs before aggregation; when we get the archive data, plugging it in
is additive, not a redesign." Practice saying that — it's the actual answer to
their question.

DELIVERABLE: aggregator with tests for all-quiet / one-watching / one-firing /
multiple-firing, the fully written Voice prompt with at least one real call
producing a convincing Cloudy quote, the working route returning the exact
contract above, the four pre-warmed cache files, and the detectConflicts
pass-through function ready to be extended.
