# Person C — Aggregator, Voice Agent, API Route

Paste everything below into a fresh Claude Code session.

---

PROJECT: "Cloudy's Second Opinion" — Reid Library's late engineer Cloudy left 5
handwritten notes describing failure patterns; nobody ever connected them to
his sensor data. Four deterministic watchers detect the patterns instantly;
when one fires, a Voice agent speaks as Cloudy, including an honest prediction
of whether an already-firing warning is likely to get worse.

Stack: Next.js (App Router) + TypeScript, Claude API.

I AM PERSON C. I own three things: the deterministic severity aggregator, the
Voice agent, and the /api/diagnose route.

MY INPUT — Person B exports checkAllWatchers(timestamp) returning:
```json
{
  "watchers": [
    { "entry": "Entry 1", "status": "firing", "subsystem": "water",
      "evidence": [ { "hour": "2026-07-05T04:00:00Z",
        "signal": "pressure_slope_6h", "value": -9.4, "threshold": -5 } ],
      "reasoning": "Pressure has fallen at 9.4 kPa/h for the last 3 hours." },
    { "entry": "Entry 3", "status": "quiet", "subsystem": "ventilation", "evidence": [], "reasoning": "..." },
    { "entry": "Entry 4", "status": "quiet", "subsystem": null, "evidence": [], "reasoning": "..." },
    { "entry": "Entry 5", "status": "quiet", "subsystem": null, "evidence": [], "reasoning": "..." }
  ],
  "listener_validation": { "entry": "Entry 2", "accuracy_vs_system_status": 1.0,
    "note": "The young dragons' ears are exactly as accurate as the sensors." }
}
```
Until their code lands, hardcode a fixture in this shape.

=== PART 1: AGGREGATOR (/lib/aggregate.ts) — plain code, NO LLM ===
```
any watcher "firing"  -> "red"      (note: in practice "firing" tracks real
                                      system_status closely since the rules
                                      were derived to match it)
else any "watching"   -> "amber"
else                  -> "green"
```
Worst-of-4 (Entry 2's listener_validation NEVER enters this calculation — it's
informational only, rendered in its own UI panel). This is a deliberate
design decision and a talking point: the traffic light must never hallucinate
green during a real emergency, so severity is computed from structured output
by code. The model's job is explaining WHY, never deciding HOW BAD.

=== PART 2: VOICE AGENT (/lib/voice.ts) ===
Runs ONLY when severity is amber or red — the one expensive call that fires
often, use claude-sonnet-5. Receives all 4 watcher outputs, the
listener_validation note, and the CURRENT knowledge ledger (from Person B's
knowledge_ledger.json / live endpoint) — so it can reference recently
reconciled information, not just Cloudy's original five.

Critical honesty rules — do not skip these, they're what separates a
trustworthy system from a hallucinating one:
- **Never predict Green→Amber (a brand-new fault starting).** Person A's
  analysis proved this is impossible (0/24 onset transitions caught). The
  Voice agent must not claim to see a new fault coming.
- **Only predict Amber→Red** (an already-firing warning escalating), and only
  when Entry 1 is firing on the water subsystem with the pressure-slope rule
  active. State the historical rate honestly: "2 of 2 past cases with this
  signature reached failure" — never a fabricated percentage like "87%
  chance."
- If any ledger entry relevant to the firing watcher(s) is `disputed`, the
  Voice agent must mention the disagreement rather than pretend certainty.

PROMPT:
```
You are the night-watch assistant for Reid Library, a dragon shelter with
damaged automation. A frightened dragon reads your output at 3am and decides
whether to wake the elders.

You will receive computed diagnostics and the current knowledge ledger. Do
not calculate anything yourself; use the numbers exactly as given.

DIAGNOSTICS
{watcher_outputs_json}

CURRENT KNOWLEDGE LEDGER (may include recently-reconciled new sources)
{current_ledger_json}

HISTORY
Two past water faults escalated to total failure within 24 hours. Two past
ventilation faults resolved on their own. Only four episodes exist, so
confidence is inherently limited and you must say so.

Return JSON only:
{
  "entry_cited": "Entry 1" | "Entry 3" | ...,
  "subsystem_scope": "water" | "ventilation",
  "mode": "plumbing" | "ventilation" | "stable",
  "headline": "under 8 words, plain language",
  "recommended_action": "one sentence, what to do right now",
  "reasoning": "2-3 sentences. Reference Cloudy's note in his voice. Use
                consequences a dragon feels (cold, no water), not statistics.
                If a relevant ledger entry is disputed, say so plainly.",
  "predicted_to_escalate": true | false,
  "escalation_basis": "the deterministic rule and historical rate that
                        justify this, e.g. 'pressure has fallen 9 kPa/h for
                        3 hours; this pattern preceded total failure in both
                        past water faults'. null if not escalating.",
  "hours_to_critical_estimate": number or null,
  "speech_text": "one short sentence, written to be read aloud by
                  text-to-speech. Plainer and shorter than reasoning. Only
                  present if predicted_to_escalate is true.",
  "confidence": "low" | "moderate" | "high",
  "caveat": "one sentence naming the limitation honestly"
}

Never invent numbers. Never claim certainty about failure timing. Never state
a percentage or probability of escalation — only the deterministic rule and
the historical count (e.g. "2 of 2 past cases"), because the sample is too
small to support a real probability. Never predict a brand-new fault starting
— only whether an already-firing warning is likely to worsen.
```

`subsystem_scope`/`mode` mapping: Entry 1 or 4 firing → "plumbing"/"water".
Entry 3 firing → "ventilation"/"ventilation". This resolves the shelter's
"two leaders" conflict for free — the recommendation is scoped to the sick
subsystem only, never a blanket shutdown.

=== PART 3: /app/api/diagnose/route.ts ===
```
GET ?ts=2026-07-05T06:00:00Z
-> { watchers, listener_validation } = await checkAllWatchers(ts)
-> severity  = aggregate(watchers)
-> ledger    = readCurrentLedger()          // Person B's ledger file/endpoint
-> diagnosis = severity === "green" ? null : await voice(watchers, ledger)
-> sum token usage across the Voice call this tick, estimate cost
-> write the full response to a local cache file keyed by timestamp
```

RESPONSE SHAPE — locked, Person D builds against this:
```json
{
  "severity": "amber",
  "watchers": [ /* 4 objects, passed through untouched */ ],
  "listener_validation": { ... },
  "diagnosis": { /* voice output, or null when green */ },
  "ledger_snapshot": [ /* current ledger rows, read-only, for the ledger panel */ ],
  "tokens_used": 850,
  "estimated_cost_usd": 0.003
}
```

The cache is not optional — Person D falls back to it if a live call stalls
on stage. Pre-warm it for these demo timestamps: 2026-07-04T23:00,
2026-07-05T04:00, 2026-07-06T00:00, 2026-07-10T06:00.

DELIVERABLE: aggregator with tests for all-quiet / one-watching / one-firing
/ multiple-firing, the fully written Voice prompt with at least one real call
producing a convincing Cloudy briefing that correctly honors the
onset-vs-escalation honesty rules, the working /api/diagnose route returning
the exact contract above, and the pre-warmed cache files.
