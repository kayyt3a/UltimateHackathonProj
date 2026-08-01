# Cloudy's Second Opinion

**Region:** Reid Library — sheltering the dragons
**Thread:** Cloudy's notes ("nobody has connected those observations to the sensor data on his old computer")
**Judged on:** Interface (usable), Data (readable), AI (meaningful, well-prompted)

## The one-sentence pitch

Cloudy left five cryptic handwritten notes before he died. Nobody ever connected
them to the sensor data on his old computer. We build that missing link: five
small AI agents each watch the live data for exactly one of Cloudy's patterns,
and only speak up — in his voice, citing his evidence — when something is
actually wrong.

## Why this idea (context for anyone new to the repo)

Don't build a generic "predictive maintenance dashboard." That's the obvious
build every other team will ship. Our edge is narrower and sharper: Cloudy's
five notes are not flavor text, they are five distinct, checkable failure
signatures hiding in the CSV. See `data/cloudys_logs.md` and
`data/dataset_README.md` for the source material.

| Note | What it's really saying | Checkable rule |
|---|---|---|
| Entry 1 — pipes complain first | Valves fail *after* pressure/flow degrade | `water_pressure_kpa` trending down while `water_flow_lps` also falls, before `system_status` hits critical |
| Entry 2 — the library has a rhythm | Dragons' ears catch what sensors miss | `sound_event` (hum/rattle) should correlate with rising `vibration_level` |
| Entry 3 — fans running in circles | Ventilation strain shows as efficiency loss, not just volume drop | `power_kw / airflow_m3s` ratio rises above its stable-state baseline |
| Entry 4 — cold arrives later | Temperature is a lagging indicator | Never treat `temperature_c` as an early-warning signal; it moves *after* the real fault |
| Entry 5 — missing pieces | Sensor silence is itself informative | Null/gap readings and `sensor_source` changes get flagged, not skipped |

Two real historical incidents are already in the data (July 5 and July 15,
plumbing collapses; July 10 and July 18–19, ventilation strain) — use these to
validate your rules and as demo replay points.

**Known data quirk:** rows with `sensor_source = barry_j_` (from 2026-07-19
18:00 onward) carry a small consistent calibration offset per the README —
find it and correct for it before feeding data to the watchers, or your rules
will misfire on real data.

## Architecture

```
Sensor CSV (hourly) ──► Calibration & Signal Prep (deterministic, no LLM)
                              │
                              ▼
                     5 Rule Watcher Agents (small/cheap model, parallel)
                     one per Cloudy note → { status, evidence }
                              │
                              ▼
                 Deterministic Severity Aggregator (no LLM — instant, trustworthy)
                     worst-of-5 → green / amber / red
                              │
                     only if amber/red ──► Voice Agent (larger model)
                              │              writes Cloudy's diagnosis:
                              │              { entry_cited, evidence, action, quote }
                              ▼
                        Single-page UI
```

**Why deterministic aggregation, not "ask the LLM for the color":** the
traffic light must never hallucinate green during a real emergency. Color is
computed from the 5 structured agent outputs with plain code. The LLM's job
is explaining *why*, not deciding severity. This is a talking point for
judges — say it out loud in the demo.

**Why 5 cheap watchers + 1 expensive voice, not one big model:** cost and
speed. Watchers run every tick constantly; the Voice model only fires when a
watcher escalates past quiet. On the July dataset that's a handful of times a
day, not hundreds. Show a live token/cost counter in the UI — it's a cheap,
memorable flex tied directly to the scenario ("the dragons can't afford one
big brain").

## The interface (must pass the "5-second glance" test)

One screen. No nav, no login, no settings page.

1. **Traffic-light banner**, top of page. Green/Amber/Red + one calm or
   urgent sentence. This is 90% of the value for a panicked user.
2. **Five rule-lights** beneath it, one per Cloudy note, each independently
   quiet/watching/firing — proves *which* problem, not just *that* there's a
   problem. Clicking a lit pill expands to the evidence and quote.
3. **One chart**: the two derived signals (power/airflow ratio,
   pressure-drop rate) plotted over time with baseline bands shaded. This is
   the "Data" rubric box — raw columns don't tell a story, derived signals do.
4. **Demo replay control**: a scrubber/slider over the July timeline so we
   can jump straight to 2026-07-05 06:00 and watch the banner escalate live
   instead of waiting for real time to pass.

Visual tone: a well-worn logbook / note taped to the wall, not an enterprise
dashboard. Warm, low-tech, handwritten-adjacent. This is a deliberate contrast
with what most other teams will ship.

## Agent prompt design

Each rule watcher gets a **short, single-purpose prompt** — do not let them
reason generally, or all five will converge on the same generic answer.

```
You watch for ONE pattern only: {entry_title}.
Cloudy wrote: "{note_text}"
Rule to check: {rule_description}

Given this data window:
{last_12h_relevant_columns}

Baseline for comparison:
{precomputed_stable_state_baseline}

Return JSON only:
{
  "status": "quiet" | "watching" | "firing",
  "evidence": [{"hour": "...", "signal": "...", "value": ..., "baseline": ...}],
  "reasoning": "one sentence"
}
```

The Voice agent only runs on amber/red and receives all 5 watcher outputs
plus the note text, returning:

```
{
  "entry_cited": "Entry 1",
  "mode": "plumbing" | "ventilation" | "stable",
  "hours_to_failure_estimate": ...,
  "subsystem_scope": "water" | "ventilation",
  "recommended_action": "...",
  "cloudy_quote": "in his voice, references the evidence directly"
}
```

`subsystem_scope` matters: it's how the tool resolves the "two leaders"
tension (manual vs. automated) without us building a separate feature for
it — the recommendation is scoped to only the sick subsystem, not a
blanket shutdown.

## Repo structure (proposed)

```
/data
  cloudys_logs.md            # source notes
  dataset_README.md          # column definitions, quirks
  reid_library_sensor_data.csv
/app  (or /src — pick one stack and commit, see below)
  /api/diagnose              # watcher + voice orchestration endpoint
  /lib
    calibration.ts           # barry_j offset correction, gap handling
    signals.ts               # derived ratio/slope calculations
    watchers.ts               # 5 prompt templates + fan-out call
    voice.ts                  # escalation-only diagnosis call
    aggregate.ts              # deterministic severity rollup
  /components
    Banner.tsx
    RuleLights.tsx
    SignalChart.tsx
    ReplayScrubber.tsx
  page.tsx                    # the single screen
```

**Stack recommendation (avoid bikeshedding — just use this):** Next.js
(App Router) single app, TypeScript, one API route for diagnosis, Claude API
for the agent calls (small model for watchers, larger model for the Voice),
Recharts or similar for the chart. No database needed — the CSV is small
enough to load in memory and slice by timestamp for the replay scrubber.

## Team split suggestion

- **Data/pipeline person:** calibration fix, derived signals, baseline
  stats, CSV loading + replay slicing. Ship first — everything else depends
  on it.
- **AI/prompts person:** the 5 watcher prompts, the Voice prompt, the
  orchestration route, the deterministic aggregator.
- **Interface person:** banner, rule-lights, chart, scrubber, visual polish.

Build order for a one-day timeline:
1. Data pipeline (calibration + derived signals) — unblocks everyone.
2. `/api/diagnose` returning real JSON for at least one hardcoded window —
   proves the AI works end to end.
3. Single-page UI wired to real output.
4. Replay scrubber + chart polish.
5. Rehearse the demo: 2026-07-04 23:00 (calm) → 2026-07-05 06:00 (Entry 1
   fires, banner escalates hours before `system_status` says critical) →
   2026-07-10 04:00 (different rule fires — Entry 3, ventilation — proving
   the tool distinguishes failure modes, not just "something's wrong").

## Definition of done (rubric self-check before demo)

- [ ] Can a stressed, non-technical user get the right answer in under 5
      seconds from the banner alone?
- [ ] Does the chart show a *derived* signal, not just raw columns?
- [ ] Does the AI output cite a specific Cloudy entry and specific numbers
      (not generic "something seems off")?
- [ ] Does the demo show at least two different rules firing at different
      times, proving differentiation, not just anomaly detection?
- [ ] Is the Barry J calibration offset handled and mentioned in the demo?
