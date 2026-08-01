# Person B — The 5 Watcher Agents

Paste everything below into a fresh Claude Code session.

---

PROJECT: "Cloudy's Second Opinion" — a hackathon tool for dragons sheltering in
Reid Library after an attack damaged the building's power, water and ventilation
systems. Their late engineer Cloudy left 5 handwritten notes describing failure
patterns; nobody ever connected them to his sensor data. We build that link.

Stack: Next.js (App Router) + TypeScript, Claude API.

I AM PERSON B. I own the five rule-watcher agents. Each is a SMALL, CHEAP model
call (claude-haiku-4-5-20251001) locked onto exactly ONE of Cloudy's notes. They
run in parallel every tick. Keeping them narrow is the entire point — if I let
them reason generally, all five converge on the same generic answer and the
product dies.

THE FIVE NOTES AND THEIR RULES:

Entry 1 — "The pipes are getting old"
  Cloudy: "The valves rarely fail without warning. The pipes seem to complain
  first. A small drop in pressure here. A weaker flow there."
  Rule: water_pressure_kpa trending down while water_flow_lps also falls,
  detected BEFORE system_status reaches critical.
  Feed this watcher only: timestamp, water_pressure_kpa, water_flow_lps.

Entry 2 — "The library has a rhythm"
  Cloudy: "Every machine has its own voice. The ventilation fans have a steady
  hum when they are happy. When they are struggling, the sound changes. A little
  vibration. A rattle that was not there yesterday. The dragons who listen may
  not understand the engineering, but they notice things sensors sometimes miss."
  Rule: sound_event (hum/rattle) should correlate with rising vibration_level.
  Also flag disagreement — a rattle logged while vibration sits at baseline may
  mean a failing sensor rather than a calm machine.
  Feed this watcher only: timestamp, sound_event, vibration_level.

Entry 3 — "The fans are working harder"
  Cloudy: "When the system is healthy, there is a linear relationship between
  power and airflow. Any deviation from this indicates poor health. It is almost
  as if the machines are running in circles — working harder but achieving less."
  Rule: power_airflow_ratio rises above baseline mean + 1 std.
  Feed this watcher only: timestamp, power_kw, airflow_m3s, power_airflow_ratio.

Entry 4 — "A cold night reminder"
  Cloudy: "When airflow drops, the temperature does not immediately change. The
  cold arrives later. Anyone watching only the temperature will notice the problem
  too late. The first signs are elsewhere."
  Rule: this watcher is the INVERSE of the others. It fires when temperature_c
  still looks normal WHILE airflow or pressure are already degrading — proving
  temperature is a lagging trap, not an early warning. If temperature has already
  moved, say so plainly: the warning window has passed.
  Feed this watcher: timestamp, temperature_c, airflow_m3s, water_pressure_kpa.

Entry 5 — "Missing pieces"
  Cloudy: "Some sensors now go silent without warning. Do not assume an empty
  space means nothing happened. Sometimes missing information is itself a clue."
  Rule: check is_gap_filled flags and sensor_source transitions in the window.
  Gaps clustering near other degradation are far more suspicious than an isolated
  gap on a calm day.
  Feed this watcher only: timestamp, is_gap_filled, sensor_source.

MY INPUT — Person A exports getWindow(timestamp) returning:
```json
{
  "records": [ { "timestamp": "2026-07-05T06:00:00Z", "power_kw": 47.04,
    "airflow_m3s": 4.38, "water_pressure_kpa": 291.351, "water_flow_lps": 1.732,
    "temperature_c": 18.677, "vibration_level": 0.33, "sound_event": "hum",
    "system_status": "warning", "sensor_source": "original",
    "is_gap_filled": false, "power_airflow_ratio": 10.74,
    "pressure_drop_rate_6h": -8.2 } ],
  "baseline": { "power_airflow_ratio": { "mean": 10.5, "std": 0.28 },
    "water_pressure_kpa": { "mean": 348, "std": 12.4 },
    "vibration_level": { "mean": 0.15, "std": 0.032 } }
}
```
Until their code lands, hardcode a fixture in this shape and build against it.

MY OUTPUT — each watcher returns EXACTLY this, locked, Person C consumes it:
```json
{
  "entry": "Entry 1",
  "status": "quiet" | "watching" | "firing",
  "confidence": "high" | "medium" | "low",
  "conflict": false,
  "conflict_note": null,
  "evidence": [
    { "hour": "2026-07-05T04:00:00Z", "signal": "water_pressure_kpa",
      "value": 314.4, "baseline": 348, "source": "sensor" }
  ],
  "reasoning": "one sentence"
}
```

Status meanings — include these in every prompt so all five calibrate
identically: "quiet" = pattern absent. "watching" = pattern emerging, not yet
urgent. "firing" = pattern clearly matches, act now.

The `source` field on each evidence item and the `confidence`/`conflict` fields
exist because of a third organizer hint: a newly recovered archive of old
maintenance records may surface later, and it can contradict the live sensor
data. For now every evidence item you produce has `source: "sensor"` and
`conflict: false`, `confidence: "high"` — you're not building conflict detection
yourself (that's Person C's job once the archive data exists), but your output
shape needs these fields present now so nothing downstream breaks when they
start getting populated.

The evidence array is not optional decoration. Person D renders those exact
numbers in the UI, and our judging criteria require the AI to cite specific
values rather than saying "something seems off." A firing or watching status
with an empty evidence array is a bug.

WHAT I NEED TO BUILD — /lib/watchers.ts:
1. Five fully written prompt strings — the actual text, not templates with
   TODOs.
2. Five helper functions that trim the window to just that entry's columns
   before it enters the prompt.
3. checkAllWatchers(timestamp) — fans out all five with Promise.all, returns
   the array of five results.
4. Strict JSON parsing with a retry or repair path. A malformed response from
   one watcher must never crash the other four.

DELIVERABLE: the five prompts, the fan-out function, and tests against two
fixtures — a calm window (2026-07-01, all five must return "quiet"; false
positives here would wreck the demo) and the 2026-07-05 06:00 window (Entry 1
fires while Entry 3 stays quiet — that contrast IS the product). Also log
per-call token usage; Person C aggregates it and the UI displays a running
cost counter.
