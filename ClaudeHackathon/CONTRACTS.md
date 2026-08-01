# Person B — interface contracts

Locked shapes. Person C's aggregator and Person D's UI code against these.

## 1. Watchers — `lib/watchers.ts`

```ts
import { checkAllWatchers } from "@/lib/watchers";
const report = checkAllWatchers("2026-07-05T06:00:00Z");
```

Pure synchronous code, no LLM, no network. Safe to call on every frame of the
replay scrubber.

```ts
{
  watchers: [ /* exactly 4: Entry 1, Entry 3, Entry 4, Entry 5 */ ],
  listener_validation: { entry: "Entry 2", accuracy_vs_system_status: number, note: string }
}
```

Each watcher:

```ts
{
  entry: "Entry 1" | "Entry 3" | "Entry 4" | "Entry 5",
  status: "quiet" | "watching" | "firing",
  subsystem: "water" | "ventilation" | null,
  evidence: [{ hour: string, signal: string, value: number, threshold: number }],
  reasoning: string   // templated plain text, not model output
}
```

**Person C:** aggregate severity from `watchers` only. `listener_validation`
is deliberately outside that array — Entry 2's sound signal maps 1:1 onto
`system_status`, so scoring it would be reading the ground-truth label.

**Person D — two rendering notes:**

- **Entry 4 must not be red.** `status: "firing"` here means "temperature just
  demonstrated it is *not* an early warning signal for this event." It is an
  informational finding, not an alarm. Give it its own visual treatment.
- **Entry 5** is a data-integrity/trust indicator, not a fault alarm. It
  mostly reports `quiet` with a calibration note.

Thresholds live at the top of `lib/watchers.ts` as named constants.

**Two behaviours to code defensively against:**

- `evidence` **can be an empty array.** Entry 4 emits no evidence when there is
  no prior hour to diff temperature against — emitting `value: 0` would have
  claimed "temperature didn't move" when the truth is "we couldn't tell".
  Don't index `evidence[0]` without a guard.
- **A watcher can be held at `watching` when its own rule says `firing`.** If
  the hours driving the verdict are `is_gap_filled`, the status is downgraded
  and the reason is appended to `reasoning`. Alarming on interpolated data is
  a demo-losing move. Person C: this means severity is already gap-aware,
  don't discount it a second time.

### ✅ Resolved — the Entry 3 baseline question

Earlier I flagged that `residual = -0.021` sat 35σ from a baseline std of
0.0006, contradicting the requirement that Entry 3 read `quiet` there.

**Real data settles it.** `prepared_data.json` gives residual std = **0.01504**,
not 0.0006 — the figure in the original brief was illustrative, not measured.
At the real std, −0.021 is ~1.4σ: entirely ordinary. Fault residuals sit near
−1.0 (`faulty_mean = -1.00001`) against a healthy mean of −0.00109, with the
threshold at −0.5006 midway between. `quiet` was correct.

Verified across the whole month: **zero false positives on all 368 stable
hours**, and Entry 3 fires inside both ventilation episodes.

### Data notes that bite

- **`pressure_slope_6h` is `null`** for the first 5 rows — a 6-hour slope is
  undefined until 6 hours exist. The type is `number | null`. Coercing null to
  0 invents a "stable pressure" reading nobody measured; Entry 1 reports the
  undefined state explicitly instead.
- **`listener_validation` is 0.952, not 1.0.** `normal→stable` and `hum→warning`
  are clean, but `rattle` covers *both* `critical` (24) and `failed` (24), so
  sound cannot separate those two. 476/500. Still leakage — sound adds nothing
  `system_status` doesn't already carry, at the same timestamp — but don't put
  "1.0" on a slide.

## 2. Live reconciliation — `POST /api/reconcile`

Person D's "new information just arrived" box calls this directly.

**Request**

```json
{ "source_label": "Archived repair note (submitted live)", "text": "..." }
```

Both fields required, non-empty strings. `400` otherwise.

**Response `200`**

```json
{ "row": { /* LedgerRow, see below */ }, "ledger_size": 7 }
```

The row is already appended to `data/knowledge_ledger.json` before the
response returns.

**Response `502`** — `{ "error": "Reconciliation failed: ..." }` if the model
call or JSON parse fails. Show the error; don't retry automatically.

**`GET /api/reconcile`** → `{ "ledger": LedgerRow[] }` for initial panel load.

### LedgerRow

```json
{
  "id": "entry_1",
  "source_label": "Cloudy's notes — Entry 1",
  "claim": "...",
  "verdict": "supported" | "refuted" | "untestable" | "disputed",
  "evidence": "...",
  "conflicts_with": "entry_3" | null,
  "data_leans_toward": "..." | null,
  "operational_rule": "pressure_slope_6h < -5 sustained 3h" | null,
  "note_to_dragons": "...",
  "timestamp_added": "2026-08-01T09:00:00Z"
}
```

Live rows get ids of the form `live_<epoch_ms>`; seeded rows use `entry_1`…`entry_5`.

`conflicts_with` is the field that carries the judging story — render it
prominently. `disputed` means the data could not settle a genuine
disagreement; that is a real verdict, not an error state.

## 3. What I need from Person A

`getWindow(timestamp)` in the agreed shape. Until it lands, `lib/fixtures.ts`
provides three hardcoded windows behind the same signature — swapping the
import in `lib/watchers.ts` is the only change needed.

I also need the real notebook numbers to replace the documented placeholders
in `lib/stats.ts`: regression R² and residual distribution, the pressure-slope
escalation validation, the sound/`system_status` confusion matrix, the
onset-lag test, and the missingness counts.
