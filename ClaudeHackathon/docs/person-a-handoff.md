# Person A — data layer landed in the real project

Everything below was verified inside `ClaudeHackathon/`, not in a sandbox.
Commands are run from that directory.

## 1. What shipped

| file | what it is |
| --- | --- |
| `lib/data.ts` | data access layer. Loads `../prepared_data.json`, slices by time, does no math. |
| `app/api/data/route.ts` | the server-side door onto it, so client components never import `fs`. |
| `tests/data.test.ts` | 24 tests against the real JSON. |
| `tests/client-boundary.test.ts` | static guard: fails if a `"use client"` file imports `lib/data.ts`. |
| `vitest.config.ts`, `package.json` | `npm test`, `npm run typecheck`, `npm run data:refresh`. |
| `README.md`, `../requirements.txt` | regeneration path. |

## 2. Verification

- `npm run typecheck` — clean.
- `npm run build` — clean; `/api/data` builds as a dynamic route.
- `npm test` — 27/27 passing.
- `npm run test:watchers` — still ALL PASS, unchanged.
- `npx next start` then `curl /api/data` — returns 500 records,
  range `2026-07-01T00:00:00Z` → `2026-07-21T19:00:00Z`, real baseline and
  derived constants. So `prepared_data.json` is readable from the cwd the app
  actually runs in, in a production build, not just under `tsx`.
- `npm run data:refresh` — runs `prepare_data.py` from the repo root and
  reproduces `prepared_data.json`. Under a newer numpy/sklearn the last ~2
  digits of the floats move; `is_novel`, every threshold and every verdict are
  identical. Do not read that diff as a change in findings.

### Path resolution (spec 2.2)

`loadRaw()`'s second candidate, `path.join(process.cwd(), "..", "prepared_data.json")`,
is the one that hits: the Next project is `ClaudeHackathon/` and the JSON sits
one level up at the repo root. No new candidate needed and the file was not
moved. If anyone ever starts the app from a different cwd, add the path to the
candidate list rather than moving the file.

### Client-component audit (spec 2.1)

**No client component imports `lib/data.ts`.** There is currently no `"use client"`
directive anywhere in the project — Person D's UI hasn't landed, `app/page.tsx`
is still the placeholder. The only importers are `app/api/data/route.ts` and the
test file, both server-side.

Because that is a point-in-time result, `tests/client-boundary.test.ts` re-checks
it on every `npm test` and I verified it actually fails when a violating file is
added. **Person D:** the chart and scrubber must `fetch("/api/data?...")`, not
import `lib/data.ts`.

## 3. Person B's open question in CONTRACTS.md — settled

> The spec's baseline gives `residual` std = 0.0006, and the spec's own example
> record for `2026-07-05T06:00Z` gives `residual = -0.021`. That is 35 standard
> deviations from healthy — yet the spec also requires Entry 3 to read `quiet`.

**The contradiction is a fixture artifact. It does not exist in the real data,
and Entry 3's current behaviour is correct — keep the absolute −0.5 threshold.**

The real record at `2026-07-05T06:00:00Z` has `residual = +0.00001`. The −0.021
in `lib/fixtures.ts` was invented for the fixture; nothing in the dataset
resembles it. That hour is a *water* episode — `pressure_slope_6h = −10.17` —
and ventilation is genuinely fine, which is exactly what Entry 3 reports.

The residual is cleanly bimodal, so the threshold is not a close call:

| band | count | what's in it |
| --- | --- | --- |
| `residual > −0.001` (healthy) | 438 | everything else |
| `−0.5 ≤ residual < −0.001` | **2** | both gap-filled interpolation artifacts |
| `residual < −0.5` (firing) | 60 | all inside the two ventilation episodes, 0 false positives |

Two consequences worth knowing:

1. **Don't use `baseline.residual.std` as the healthy noise floor.** It reads
   0.0150, but that is inflated ~50× by exactly those two gap-filled hours
   (−0.230 and −0.175). The honest healthy spread is ~3×10⁻⁴ — use
   `derived_constants.airflow_model.residual_sd` (0.000298, fit on 326 rows)
   for any σ figure you print. The σ number in Entry 3's `reasoning` is
   understating distance by ~50× today. I have deliberately **not** regenerated
   `prepared_data.json` to change `baseline.residual.std` mid-build — it would
   churn every number B, C and D are looking at for a cosmetic gain.
2. `RESIDUAL_WATCHING_THRESHOLD = −0.25` has no real records in its band. On
   live data Entry 3 will only ever read `quiet` or `firing`. That's honest, not
   broken — just don't expect to demo the buffer zone.

## 4. Before you swap `fixtures` → `data` in `watchers.ts`

`checkAllWatchers` cannot switch imports as-is. Three things break, all
verified by compiling the swap:

1. **`pressure_slope_6h` is `number | null`, and the nulls are real.** The first
   5 records have no 6h history yet. `tsc` rejects the swap outright
   (`Type 'number | null' is not assignable to type 'number'`), and at runtime
   `checkEntry1`'s `current.pressure_slope_6h.toFixed(1)` throws
   `Cannot read properties of null` for any timestamp before
   `2026-07-01T05:00:00Z`. Needs a null guard in `checkEntry1` / `hasDegradation`,
   and `lib/types.ts` needs `pressure_slope_6h: number | null`. I did not widen
   it to `number` in `lib/data.ts` on purpose — that would trade a compile error
   for a silent crash.
2. **`Baseline` needs its index signature relaxed.** `lib/types.ts` declares
   `[key: string]: BaselineStat`; my `Baseline` is a plain interface, so TS
   reports `Index signature for type 'string' is missing`. Dropping the index
   signature from `lib/types.ts` is the cleaner fix.
3. **`getWindow` no longer throws on an unknown timestamp** — it returns an
   empty `records` array, and `indexOfTimestamp` then throws
   `Window does not contain a record at …`. The scrubber must move in exact
   hourly steps (`getTimestampRange()` gives the bounds); an arbitrary
   timestamp needs `getRecordAt()` first to snap to the hour.

## 5. Numbers for the `lib/stats.ts` placeholders (CONTRACTS.md §3)

I'm leaving `lib/stats.ts` alone — it's yours. These are the real values; three
of the placeholders are wrong in a way a judge could catch.

**Baselines** (`getBaseline()`):

| channel | mean | std |
| --- | --- | --- |
| `residual` | −0.00109 | 0.01504 — see §3, use 0.000298 as the healthy floor |
| `water_pressure_kpa` | 350.41 | 11.66 (placeholder says 348 / 12.4) |
| `vibration_level` | 0.15022 | 0.02886 |

**Entry 3 / regression.** `airflow = 0.125000 × power − 1.500003`,
R² = 0.9999992, residual SD = 0.000298, n = 326.
`residual < −0.5` is **~1670 healthy σ** below the mean using that clean floor —
the "roughly 800 standard deviations" line is the right order of magnitude but
not the actual number.

**Entry 1 / escalation.** `pressure_slope_6h < −5 kPa/h sustained 3h` fires on
49 hours across the series: 48 of them inside the two water episodes, 1 false
positive (`2026-07-03T20:00:00Z`, stable, outside any episode). Both water
episodes escalated (n = 2 — a count, not a rate). Lead time ≈ 8h.

**Entry 2 — the placeholder is wrong.** `accuracy_vs_system_status` against a
modal sound→status map is **0.952 on the full dataset, not 1.0**, and the
confusion matrix is not diagonal:

| sound_event | system_status | n |
| --- | --- | --- |
| normal | stable | 368 |
| hum | warning | 84 |
| rattle | critical | 24 |
| rattle | **failed** | 24 |

`rattle` spans two statuses, so sound→status is one-to-many and the 24 `failed`
hours are what costs the 4.8%. The leakage argument is *unchanged and still
correct* — the map is deterministic in the `status → sound` direction, every
status has exactly one sound — but "zero off-diagonal / accuracy 1.0" in
`lib/stats.ts` and `verdicts.md` overstates it. Say "each system_status maps to
exactly one sound_event" instead; it's both true and just as damning.

**Entry 5 — neither firing condition can occur on real data.**
`prepare_data.py` applies the Barry J calibration before writing the JSON, so
**0 of 50** `barry_j_` records have `airflow_corrected === airflow_m3s`;
`suspectCalibration` will never be true. And there are 6 gap-filled hours total,
all isolated (longest consecutive run = 1), so `clustering` (≥3) never fires
either. On live data Entry 5 reads `watching` whenever a `barry_j_` or
gap-filled hour is in the window and `quiet` otherwise. The current fixture
manufactures both conditions. That matches the verdict — "gaps are informative"
is unsupported — but if the demo needs Entry 5 to visibly do something, it has
to be on the fixture, not the live feed.

**Missingness.** 6 gap-filled hours: `2026-07-02T01`, `07-03T07`, `07-04T13`,
`07-07T01`, `07-12T16`, `07-18T07`. Scattered across the month, none adjacent to
an episode boundary. 50 `barry_j_` rows of 500.

**Your two placeholder thresholds, now measurable:**

- `PRESSURE_WATCHING_THRESHOLD = −2` flags 72 of 363 stable hours (20%) — better
  than the "half of healthy hours" you feared, but the stable slope is far
  noisier than expected (std 9.74, p95 +6.06, max +71.6). The 5th percentile of
  stable slope is **−4.31**; that's the defensible floor if you want one.
- `TEMP_MOVEMENT_EPSILON = 0.02` is **below the noise floor** — 360 of 363
  stable hours move ≥0.02 °C/h, median |ΔT| is 0.44 °C/h, σ = 0.66. As written,
  Entry 4 fires on noise for essentially every degradation hour. It reaches the
  right conclusion for the wrong reason. **≈1.3 (2σ)** is a real "temperature
  moved" test.

## 6. GMM novelty (spec 2.4)

Present and live in `prepared_data.json`: `novelty_score` and `is_novel` on all
500 records, `derived_constants.novelty_model.threshold = −6.5118`. 130 of 500
hours flag novel; `is_novel` agrees exactly with `novelty_score < threshold`
(asserted in the test suite).

The optional badge was **not wired** — Person D's UI doesn't exist yet, and the
spec says don't block on it. It's a two-line read whenever they want it:

```ts
const res = await fetch(`/api/data?timestamp=${currentTimestamp}`);
const { record } = await res.json();
const noveltyLabel = record?.is_novel ? "never seen before" : "pattern recognised";
```

It must never affect severity.

## 7. One thing I changed outside my files

`tsconfig.json` had `"ignoreDeprecations": "6.0"`, which TypeScript 5.9 rejects
(`error TS5103`). It made `tsc --noEmit` and `next build` fail before any of my
code existed. I removed the line; nothing in the config is actually deprecated,
and both are clean now.

---

## Handoff message

> Data pipeline's done and now verified inside the real project.
> `prepared_data.json` is the source of truth, `lib/data.ts` gives you
> `loadAllRecords()` / `getWindow(timestamp, hoursBack)` / `getBaseline()` /
> `getDerivedConstants()` / `getRecordAt(timestamp)` — import server-side only
> (Route Handlers / Server Components — it uses `fs`, will break in client
> components; go through `GET /api/data` instead). No need to write your own
> JSON parsing or hardcode any threshold. GMM novelty fields
> (`novelty_score`/`is_novel`) are on every record if you want them — optional,
> not required.
>
> **Person B:** your Entry 3 question is answered in §3 — the 35σ contradiction
> is a fixture artifact, the real record is +0.00001 and `quiet` is right; keep
> the −0.5 threshold. Before you swap `fixtures` → `data`, read §4: three things
> break, one of them is a runtime crash on null `pressure_slope_6h`. Real
> numbers for `lib/stats.ts` are in §5, including two placeholders that are
> currently wrong (Entry 2 is 0.952, not 1.0) and measured values for both of
> your TODO thresholds.
