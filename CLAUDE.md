# Cloudy's Second Opinion

**Region:** Reid Library — sheltering the dragons
**Thread:** Cloudy's notes ("nobody has connected those observations to the sensor data on his old computer")
**Judged on:** Interface (usable) · Data (readable) · AI (meaningful, well-prompted)

This document merges two independent planning passes into one canonical plan.
If anything you're building conflicts with this file, this file wins — it
supersedes earlier drafts.

---

## ⚠ The actual judging question (from the official hint)

> The dragons power on another section of the building and recover months of
> archived maintenance records, partial sensor logs and unfinished repair
> notes. This newly recovered information doesn't always agree with Cloudy's
> notes, the current sensors, or the young dragons' observations.
>
> **During judging, you will be asked: how would your solution support good
> decision-making when new information continuously becomes available and
> existing sources disagree?**

This is not flavor text — it's confirmation of a rubric question that will be
asked live, likely with a document you've never seen. The **Reconciliation
Agent + Knowledge Ledger** (below) exists specifically to answer this,
demonstrably, on the spot.

---

## The one-sentence pitch

Cloudy left five cryptic handwritten notes before he died, and nobody ever
connected them to the sensor data on his old computer. We build that missing
link — an AI reads any note, turns it into a testable claim, checks it against
weeks of sensor data, and tells you whether it's true. Three of Cloudy's five
were wrong. When a new, contradicting document turns up — and it will — the
same pipeline processes it live, on the spot, and shows exactly where it
agrees or disagrees with what we already trust, instead of quietly picking a
winner.

## The line that wins the pitch

> Every other team will show you a model that predicts failure. We tested
> whether these failures are predictable — onset isn't, we have the evidence.
> So we built what *is* possible: telling a dragon at 3am which alarms are
> worth waking someone for. And when a new document shows up that contradicts
> what we thought we knew, we don't quietly trust the newest thing — we test
> it exactly the way we tested Cloudy, and show both claims side by side if
> the data can't settle it.

---

## Why this thread, and why the design changed mid-build

We picked Reid Library / Cloudy's notes because it's the only thread where an
LLM is load-bearing, not decorative. The original plan ran 5 small LLM agents
as "watchers." **That design is now wrong and has been replaced**: real
analysis of the CSV showed every one of the five rules reduces to simple
arithmetic on derived signals. Asking a language model to evaluate
`-9.4 < -5` is slower, costs money, can hallucinate, and a judge will ask why.
So: **watchers are deterministic code.** The two things that remain genuinely
AI-shaped — turning prose into a testable claim, and turning diagnostics into
a decision a frightened dragon can act on — are exactly where the two
remaining LLM components live.

---

## Ground truth — verified against the real CSV, do not re-derive

### The core physical identity

```
airflow_m3s = 0.125 * power_kw - 1.5     r² = 0.999999, residual SD = 0.0003
```

Holds exactly in health, in `critical`, and in `failed`. Broken by exactly one
thing — a ventilation fault subtracts a constant `1.0 m³/s` of airflow.

```
residual = airflow_corrected - (0.125 * power_kw - 1.5)
≈  0.000  ventilation healthy
≈ -1.000  ventilation fault
```

### Barry J calibration offsets (subtract from `barry_j_` rows)

| Channel | Offset | Confidence |
|---|---|---|
| `airflow_m3s` | **+0.1496** | Exact |
| `water_pressure_kpa` | **+8.73** | Statistical, 95% CI ≈ [4.9, 12.6] |
| `water_flow_lps` | **+0.063** | Statistical, 95% CI ≈ [0.01, 0.11] |
| power, temp, vibration | not significant | leave alone |

`sensor_source = barry_j_` from 2026-07-19 18:00 onward. Stored value is
truncated to `barry_j_`, not `barry_j_smart_sensor` as the README claims.

### The four episodes

| Onset | Duration | Subsystem | Outcome |
|---|---|---|---|
| 2026-07-05 00:00 | 36h | water | warning 12h → critical 12h → **failed** 12h |
| 2026-07-10 04:00 | 30h | ventilation | warning only, **resolved** |
| 2026-07-15 00:00 | 36h | water | warning 12h → critical 12h → **failed** 12h |
| 2026-07-18 22:00 | 30h | ventilation | warning only, **resolved** |

**The product exists because of this table.** A 50% base rate means "warning"
alone tells a dragon nothing about what to do. Triage is the problem.

### Escalation signature (water faults only) — the ONE predictable transition

```
pressure_slope_6h < -5 kPa/h for 3 consecutive hours  →  escalating
```

Separates cleanly by roughly hour 4 of the warning phase, ~8h lead time
before critical. **n = 2 positive examples. Say this out loud, always.**

### What is NOT predictable — say this too

Onset (a brand-new fault starting) is a step function. The 12h before each
episode is statistically indistinguishable from baseline (noise floor
0.0003). A softmax classifier predicting status at t+6h scores 84.8% accuracy
and catches **0 of 24 onset transitions** — the accuracy is pure persistence.
Do not build a forecaster for onset. This finding is itself a slide.

---

## Cloudy's five notes — verified verdicts

| Note | Claim | Verdict | Rule we run |
|---|---|---|---|
| **1 — pipes complain first** | Pressure/flow degrade before valve failure | **SUPPORTED** | `pressure_slope_6h < -5` sustained 3h → escalating water fault |
| **2 — the library has a rhythm** | Dragons' ears catch what sensors miss | **TRUE BUT REDUNDANT** | `sound_event` maps 1:1 onto `system_status` — zero off-diagonal. The listeners are exactly as accurate, never earlier |
| **3 — fans running in circles** | Ventilation strain = efficiency loss, not volume drop | **SUPPORTED, strongest** | `residual < -0.5` → ventilation fault. Perfect detection |
| **4 — cold arrives later** | Temperature lags the real fault | **REFUTED** | Airflow and temperature drop in the *same hour*. Lag correlation peaks at lag 0 |
| **5 — missing pieces** | Sensor silence is informative | **UNSUPPORTED as stated** | Only 6 nulls, scattered in stable periods — n=6 can't distinguish MNAR from MCAR. Repurposed below |

### Three corrections that matter for implementation

**Entry 3 uses the residual, not a power/airflow ratio.** A ratio ignores the
−1.5 intercept; its healthy band is 14.2% wide. The residual's healthy band is
~0.0006 wide — roughly 200× the margin. Use the residual.

**Entry 2 is a leakage trap — exclude it from severity entirely.** Feeding
`sound_event` into a detector means reading the answer key, since it's a
deterministic function of `system_status`. It gets its own UI panel — "the
listeners, scored" — a confusion matrix vindicating the young dragons with
evidence instead of using their ears as a feature.

**Entry 5 becomes the data-integrity / calibration watcher.** The null-gap
claim doesn't survive, but the note's real content — "the Giant Peacock
damaged more than the machines" — points at sensor trustworthiness, which
genuinely is broken (Barry J's offset). Watcher 5 monitors `sensor_source`
changes and flags whether the correction has been applied.

---

## Architecture

```
OFFLINE — once, before the demo
cloudys_logs.md ──► RECONCILIATION AGENT (LLM) ──► verified claims
                     reads prose, proposes a test,
                     reads the computed statistic,
                     returns supported/refuted/
                     untestable/disputed
                              │
                              ▼
                     knowledge_ledger.json (append-only, versioned)

LIVE — during the demo, on demand, SAME agent as above
new document (typed/pasted, incl. one a judge hands us)
──► RECONCILIATION AGENT ──► checked against every existing ledger entry,
                              not just Cloudy's original five
    agrees   → new row added, marked "confirms Entry N"
    conflicts→ new row added as DISPUTED, both claims shown, data-backed
               lean stated if one exists, NOTHING silently overwritten

ONLINE — every tick, deterministic, NO LLM
sensor row ──► calibration correction (Barry J offsets)
           ──► derived signals: residual, pressure_slope_6h
           ──► 5 rule watchers → {status, evidence} each
               (Entry 2 excluded from severity — validation panel only)
           ──► SEVERITY AGGREGATOR: worst-of-4 → green/amber/red

ONLINE — fires only on amber/red
all watcher outputs + current ledger ──► VOICE AGENT (LLM) ──► briefing
    + honest escalation prediction (Amber→Red only) + TTS speech_text
```

**The Reconciliation Agent is the "note interpreter," generalised** — same
prompt shape, same "prose in, tested claim out" job, callable at runtime on
arbitrary text instead of five fixed entries baked in offline. Not a new
component to build from scratch — an existing one made reusable.

### Why a ledger, not a fixed table

A fixed five-row table answers "what did Cloudy say." It can't answer what
happens when a sixth thing arrives. The ledger is append-only: every claim
ever tested — from Cloudy, from a new record, from anywhere — gets a row with
its source, verdict, what it agrees/conflicts with, and when it was added.
The UI reads the live ledger, not a snapshot.

### Why disagreement is a UI state, not something to hide

The tempting shortcut — newest document wins, overwrite the old verdict —
fails the actual question, because newer isn't more correct. **When two
sources disagree and the data doesn't clearly arbitrate, both claims stay
visible, both labelled by source, and whichever the data leans toward is
stated with its evidence — never a silent pick.** This is the single most
important design decision in the project. Say it explicitly in the demo.

### Why the watchers are deterministic code, not LLM calls

Asking a model whether `-9.4 < -5` is slow, costs money, can hallucinate.
Deterministic watchers run in microseconds — which is what makes the replay
scrubber possible at all (dragging across 500 hours would fire 2,500 LLM
calls and take over an hour). This is not a compromise for cost; it's what
makes the product usable. Say that on stage.

### Why deterministic aggregation

The traffic light must never hallucinate green during a real emergency.
Colour is computed from structured watcher output in plain code. The LLM
explains *why*; it never decides severity.

---

## Voice announcements — predicting Red, precisely

| Transition | Predictable? | What we announce |
|---|---|---|
| Green → Amber (new fault starts) | **No — proven impossible.** 0/24 onset transitions caught | Nothing. We don't pretend to see this coming |
| **Amber → Red** (firing warning worsens) | **Yes.** Entry 1's pressure-slope rule, ~8h lead time, validated on 2 historical failures | **This is what the Voice agent announces** |

Two rules protect the honesty story:

1. **The banner colour never jumps ahead of the truth.** It stays Amber until
   `system_status` genuinely reaches critical/failed. The prediction is a
   separate layer — a pulsing "likely escalating" badge plus a spoken
   warning — on top of an honest Amber, never an early Red.
2. **Never announce a fabricated probability.** Say "this pattern has
   preceded total failure both times we've seen it, roughly 8 hours out" —
   true, checkable, still urgent. Not "87% chance of failure."

Speech uses the browser's built-in `SpeechSynthesisUtterance` — free, instant,
no new backend, thematically on-brand.

`subsystem_scope` in the Voice output resolves the "two leaders" tension for
free: the recommendation is scoped to the sick subsystem only, never a
blanket shutdown.

---

## AI/ML component inventory

| # | Component | Type | When | Why it can't be code |
|---|---|---|---|---|
| 1 | **Reconciliation Agent** | LLM (Sonnet) | Offline for Cloudy's 5 + **live, on demand** | Converts prose into a testable claim and checks it against everything already trusted |
| 2 | Rule watchers (4 active + 1 validation-only) | Deterministic | Every tick | It can be code, so it is code |
| 3 | Severity aggregator | Deterministic | Every tick | Must never hallucinate green |
| 4 | **Voice agent** | LLM (Sonnet) | Amber/red only | Turns diagnostics + ledger state into a decision a frightened dragon can act on |

Component 1 is evaluable twice: offline (we know the correct verdicts for
Cloudy's five — if the agent reproduces them, that's a real eval) and live
(when judges hand us a new document, checked in front of them).

---

## Cost and latency — why thin AI is the right answer

Two LLM components total. Across the whole dataset plus a handful of live
reconciliation calls during judging: roughly **$0.10–0.15** total. The
rejected five-LLM-watcher design would run ~2,500 calls (~$4–8) and make the
scrubber impossible — each drag would fire dozens of calls and stall for
seconds. Deterministic detection is also 100% reproducible; an LLM asked
"is -9.4 < -5" is *usually* right, and "usually" isn't a property you want in
the component deciding whether to wake the elders on a cold night.

Rehearsed answer: *"We used AI in the two places where nothing else works,
and arithmetic everywhere else. A system that puts a language model in front
of a subtraction isn't more advanced, it's worse. Knowing where not to put
the model is the engineering."*

Show a live token/cost counter in the UI.

---

## The interface — must pass the 5-second glance test

1. **Login / boot screen.** Organizers require a login page, no real auth.
   Frame it as booting Cloudy's old computer — dark CRT terminal, pre-filled
   `user: cloudy`, password accepts anything, short boot sequence, skip
   affordance. Narrative payoff, not friction.
2. **Traffic-light banner.** Green/amber/red, always true to the deterministic
   aggregation — never advanced early for a prediction. One sentence from the
   Voice agent once amber/red.
3. **Escalation badge + spoken announcement.** Pulses only during Amber, only
   for the proven-predictable Amber→Red case, states the historical rate
   honestly ("2 of 2 past cases").
4. **Four active rule-lights** (Entry 1, 3, 4, 5) — quiet/watching/firing,
   click to expand evidence. **Plus one separate "the listeners" panel**
   (Entry 2) that never drives colour — a confusion matrix proving the
   dragons' ears are exactly as accurate as the sensors.
5. **One chart** — residual and `pressure_slope_6h` over time, healthy bands
   shaded. Raw columns don't tell a story; derived signals do.
6. **Replay scrubber** across the July timeline + quick-jump buttons to the
   demo moments. Only possible because detection is instant arithmetic.
7. **Knowledge ledger panel** — every claim ever tested, any source, with
   ✓ supported / ✗ refuted / ? untestable / **⚠ disputed**. Disputed rows are
   visually distinct and expand to show both claims side by side.
8. **"New information just arrived" panel.** A text box. Paste any document —
   the Reconciliation Agent runs live, a new ledger row appears, conflicts
   are shown immediately. This is the direct, demoable answer to the
   guaranteed judging question.
9. **Token/cost counter**, small, in a corner.
10. **Collapsed "how we know this" panel** embedding 2–3 figures from the
    analysis notebook (calibration fix, regression/residual, escalation
    lead-time). Satisfies the "show your data-science method" hint inside
    the product itself.

**Visual tone:** everything after login is a worn logbook — warm, low-tech,
handwritten-adjacent. The cold CRT login is a deliberate contrast: you boot
his machine, then his voice comes through.

---

## Constants — paste straight in

```
AIRFLOW_SLOPE = 0.125
AIRFLOW_INTERCEPT = -1.5
BARRY_AIRFLOW_OFFSET = 0.1496
BARRY_PRESSURE_OFFSET = 8.73
BARRY_FLOW_OFFSET = 0.063

residual = airflow_corrected - (0.125 * power_kw - 1.5)
vent_fault = residual < -0.5
water_escalating = pressure_slope_6h < -5 for 3 consecutive hours

DEMO_CALM = "2026-07-04 23:00"
DEMO_WATER_FIRES = "2026-07-05 04:00"
DEMO_FAILURE = "2026-07-06 00:00"
DEMO_VENT_FIRES = "2026-07-10 06:00"
```

---

## Analysis notebook — six figures (see person-a brief for detail)

1. Calibration offset before/after (Barry J).
2. Baseline distributions with ±1σ bands.
3. Power–airflow regression fit + residual-over-time, incidents shaded.
4. Sound vs vibration/system_status correlation — the Entry 2 leakage proof.
5. Onset-predictability test — 0/24 caught, proves onset isn't forecastable.
6. Escalation lead-time analysis — scoped to the 2 water episodes, n=2 stated.
Plus a missingness analysis feeding the Entry 5 pivot.

These figures are both the required data-science deliverable and the source
material embedded in the UI's collapsed panel.

---

## Team split

- **Person A — Data pipeline + analysis notebook.** Ships first, everyone
  depends on it.
- **Person B — Deterministic watchers + Reconciliation Agent.** The watcher
  code is now small; the Reconciliation Agent (offline seed + live endpoint)
  is the new centre of gravity.
- **Person C — Voice agent + `/api/diagnose` orchestration route.**
- **Person D — Login/boot screen + full interface**, including the ledger
  panel and the live-ingest text box (wired to Person B's endpoint).

Full detail, JSON contracts, and prompts for each are in `/briefs/`.

---

## Demo script (90 seconds)

1. Open at **2026-07-04 23:00**. Green. All lights quiet.
2. Drag to **2026-07-05 04:00**. Entry 1 fires. Amber. Voice cites Cloudy on
   the pipes complaining first. Escalation badge pulses, browser speaks the
   warning — while the banner honestly stays Amber, ~8h before failure.
3. Drag to **2026-07-06 00:00**. Red. Failed. Shelter at 15°C.
4. Jump to **2026-07-10 06:00**. A different light fires — Entry 3,
   ventilation, residual −1.000. Voice says ventilation only, historically
   self-resolving, don't wake anyone. *This is the whole product.*
5. Open the ledger panel. Three crosses. "Cloudy was wrong about three of
   his five hunches. Nobody had ever checked."
6. Paste in a rehearsed contradicting document (or whatever a judge hands
   us). Watch the Reconciliation Agent return `disputed` or `refuted` live,
   with evidence, ledger updating in front of everyone.

---

## Definition of done

- [ ] Right answer from the banner alone in 5 seconds?
- [ ] Chart shows a derived signal, not raw columns?
- [ ] AI output cites a specific note and specific numbers?
- [ ] Two different lights fire at different times (differentiation, not
      generic anomaly detection)?
- [ ] Barry J offset handled and mentioned in the demo?
- [ ] `sound_event` excluded from every severity path (leakage check)?
- [ ] Voice output states the n=2 limitation in plain language?
- [ ] Demo works with the wifi off (cached fallbacks)?
- [ ] Reconciliation Agent takes arbitrary live text, not just Cloudy's five?
- [ ] A genuinely contradicting document produces a visible `disputed` state?
- [ ] Rehearsed the live-ingest moment at least once with our own document?
- [ ] Predicted-Red announcement fires only on Amber→Red, never onset?
- [ ] Banner colour stays honest while the spoken warning plays?
- [ ] Login/boot screen present, no real auth required?

---

## Anticipated questions

| They ask | We say |
|---|---|
| **"How does your solution support good decision-making when new information continuously arrives and sources disagree?"** (guaranteed) | We don't overwrite what's verified — we test the new claim the same way we tested Cloudy's own notes, against sensor data and every existing claim. If the data settles it, we say so. If not, we show both claims side by side, labelled by source. Then demo it live |
| "Only two components use AI — thin?" | Cost/latency/reliability answer above. Lead with the scrubber being impossible otherwise |
| "Can you predict failures before they start?" | Depends which transition. A brand-new fault — no, tested, 0/24. An already-firing warning worsening — yes, ~8h lead time, that's what we announce |
| "Isn't n=2 too small?" | Yes. It's on our limitations slide, stated honestly every time we use it |
| "Why not use the sound data as a feature?" | It's 1:1 leakage off the ground-truth label. We show it as a validation panel instead |

## Honest limitations — put these on a slide

- n=2 escalations; fault type and outcome are perfectly confounded.
- Onset is unpredictable, tested: 0/24.
- The data is likely synthetic (`r² = 0.999999` isn't a real building) — the
  method is the deliverable, not the constants.
- `recovering` appears zero times in the data; recovery here is instantaneous,
  which no real plumbing does.
