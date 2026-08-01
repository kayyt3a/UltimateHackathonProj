# Cloudy's Second Opinion — Person C

Reid Library's late engineer Cloudy left 5 handwritten notes describing failure
patterns; nobody ever connected them to his sensor data. Four deterministic
watchers detect the patterns instantly; when one fires, a Voice agent speaks as
Cloudy, including an honest prediction of whether an already-firing warning is
likely to get worse.

This slice is **Person C**: the deterministic severity aggregator, the Voice
agent, and the `/api/diagnose` route.

## Quick start

```bash
npm install
npm test              # 53 tests, no API key needed
npm run dev           # http://localhost:3000/api/diagnose?ts=2026-07-05T04:00:00Z

export ANTHROPIC_API_KEY=sk-ant-...
npm run voice:demo    # one real Voice call + honesty audit
npm run prewarm       # fill the demo cache with real briefings
```

## The design decision worth talking about

**Severity is computed by code. The model never touches it.**

`aggregate(watchers)` is a pure worst-of-4 fold over structured watcher output:
any `firing` → red, else any `watching` → amber, else green. It takes exactly
one argument, and `listener_validation` is deliberately not it — Entry 2 is
informational, rendered in its own panel, and there is no code path by which it
can move the traffic light. The traffic light must never hallucinate green
during a real emergency, so the model's job is explaining **why**, never
deciding **how bad**.

An unrecognised watcher status fails *upward* to amber, never to green.

## Honesty rules, enforced twice

Person A's analysis proved onset is not predictable: 0 of 24 green→amber
transitions were caught. So the rules are computed in code (`lib/escalation.ts`),
injected into the prompt as explicit rulings, and then **re-checked against the
model's reply** (`enforceHonesty` in `lib/voice.ts`). If the model breaks a rule
anyway, code overrules it and the override is reported in `warnings[]`.

| Rule | Enforcement |
| --- | --- |
| Never predict a brand-new fault starting (green→amber) | `predicted_to_escalate` forced to `false` unless Entry 1 is firing on **water** with the **pressure-slope** rule active |
| Only ever cite the real historical rate | A `%`, "probability", "odds" or "chance of" anywhere in the output is flagged; `escalation_basis` is replaced with "…preceded total failure in 2 of 2 past water faults" |
| Never invent failure timing | `hours_to_critical_estimate` cleared to `null` whenever escalation is not predicted |
| Nothing spoken aloud unless escalating | `speech_text` dropped unless `predicted_to_escalate` is true |
| Disputed knowledge must be named | If a relevant ledger row is `disputed` and the reasoning never says so, it is flagged |
| Never a blanket shutdown | `subsystem_scope`/`mode` are set by code, not the model: Entry 1 or 4 → `water`/`plumbing`, Entry 3 → `ventilation`/`ventilation` |

That last row resolves the shelter's "two leaders" conflict for free — the
recommendation is always scoped to the sick subsystem only.

## API contract — LOCKED (Person D builds against this)

`GET /api/diagnose?ts=2026-07-05T04:00:00Z`

```json
{
  "severity": "amber",
  "watchers": [ /* 4 objects, passed through untouched */ ],
  "listener_validation": { "entry": "Entry 2", "accuracy_vs_system_status": 1.0, "note": "..." },
  "diagnosis": { /* voice output, or null when green */ },
  "ledger_snapshot": [ /* current ledger rows, read-only */ ],
  "tokens_used": 850,
  "estimated_cost_usd": 0.003
}
```

Two **optional, additive** fields you can ignore: `served_from_cache` (true when
the live call failed and the cached diagnosis was served) and `warnings` (the
deterministic guardrails that had to overrule the model this tick — useful for
an honesty panel).

`&cache=only` serves the pre-warmed file without any live call. That is the
on-stage escape hatch if the network is slow. A malformed `ts` returns 400.

Green never makes a Voice call: `diagnosis` is `null`, `tokens_used` is `0`.

## Pre-warmed cache

Committed under `.cache/diagnose/`, keyed by timestamp, for the four demo
timestamps:

| Timestamp | Severity | What it demonstrates |
| --- | --- | --- |
| `2026-07-04T23:00:00Z` | green | No Voice call, no cost |
| `2026-07-05T04:00:00Z` | red | Entry 1 firing on water — the **one** case where escalation may be predicted |
| `2026-07-06T00:00:00Z` | amber | Entry 3 watching |
| `2026-07-10T06:00:00Z` | red | Entry 3 firing — escalation **must be refused**, and disputed ledger row `L-003` must be named |

Re-run `npm run prewarm` to refresh.

## Layout

```
lib/aggregate.ts        Part 1 — worst-of-4 severity. No LLM.
lib/escalation.ts       The deterministic onset/escalation and scope rules
lib/voice.ts            Part 2 — prompt, claude-sonnet-5 call, enforceHonesty
lib/diagnose.ts         One tick: watchers -> severity -> ledger -> voice -> cache
app/api/diagnose/route.ts  Part 3 — the locked contract
lib/watchers-impl.ts    INTEGRATION POINT — Person B swaps this one file
lib/fixtures/watchers.ts   Stand-in watcher output in Person B's exact shape
data/knowledge_ledger.json Stand-in ledger; override with KNOWLEDGE_LEDGER_URL/PATH
```

## Integration

- **Person B — watchers:** replace the body of `lib/watchers-impl.ts` with
  `export { checkAllWatchers } from "<your module>"` and set
  `USING_FIXTURE = false`. Nothing else changes.
- **Person B — ledger:** set `KNOWLEDGE_LEDGER_URL` (live endpoint) or
  `KNOWLEDGE_LEDGER_PATH` (file). Both fall back to the checked-in fixture, and
  a bare array, `{entries:[…]}`, `{ledger:[…]}`, `{rows:[…]}` or `{data:[…]}`
  are all accepted. Rows are passed through verbatim into `ledger_snapshot`.

## Model and cost

`claude-sonnet-5`, the one expensive call that fires often — and only when
severity is amber or red. Cost uses Sonnet 5 introductory pricing ($2/$10 per
MTok) through 2026-08-31 and list pricing ($3/$15) after, so the demo readout is
not overstated. A typical tick is a fraction of a cent.
