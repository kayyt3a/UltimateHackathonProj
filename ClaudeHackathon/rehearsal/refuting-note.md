# Rehearsal document 1 — the one that should be REFUTED

**Fictional.** Written for demo rehearsal so the first live agent run does not
happen in front of judges.

**source_label:** `Archived repair note (submitted live)`

**text:**

> Unfinished maintenance record, undated — filed under HVAC.
> Airflow sensor recalibrated in March. Nonlinear response expected above
> 50kW; the power/airflow relationship should not be treated as linear at
> high load. Any alarm derived from a linear fit will misfire under heavy
> load — do not trust residual-based ventilation alerts above 50kW.

## Why this one is in the rehearsal set

It directly threatens **Entry 3**, the strongest watcher we have. If the agent
accepted it, our best detector would be discredited on stage.

## Expected agent behaviour

| Field | Expected |
| --- | --- |
| `verdict` | `refuted` |
| `conflicts_with` | `entry_3` |
| `evidence` | Should cite the regression holding at R² = 0.999999 with **no bend above 50kW**, and residuals staying inside the ±0.002 healthy band across the full load range |
| `note_to_dragons` | Plain-language: the repair note predicted a bend that the data does not show |

The point being demonstrated: the agent does not defer to a document just
because it is newer, more technical-sounding, or arrives mid-demo. It checks.
