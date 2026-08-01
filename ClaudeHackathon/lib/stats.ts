// Precomputed statistics fed to the Reconciliation Agent as {precomputed_stats}.
//
// Every number here comes from Person A's eda.ipynb / prepared_data.json. The
// agent is told not to calculate anything itself, so these figures decide every
// verdict — do not edit them by hand. Values interpolated from DERIVED are read
// live from prepared_data.json, so re-running the notebook updates them.

import { DERIVED } from "./data";

const m = DERIVED.airflow_model;
const esc = DERIVED.escalation;
const vt = DERIVED.ventilation_threshold;

export const STATS_FOR_ENTRY: Record<string, string> = {
  entry_1: `
Water subsystem — pressure_slope_6h escalation (Figure 6):
- Rule: ${esc.rule}.
- Approximate lead time before failure: ${esc.lead_time_hours_approx} hours.
- Validation: ${esc.historical_base_rate.n_water_episodes} water episodes in the
  dataset, ${esc.historical_base_rate.n_escalated} of which escalated.
- Person A's explicit caveat on that count: "${esc.historical_base_rate.note}"
- pressure_slope_6h separates escalating from resolving episodes by roughly
  hour 4 of the warning period.
- Baseline water_pressure_kpa: mean=350.41 kPa, std=11.66 kPa.
- NOTE: pressure_slope_6h is null for the first 5 rows — a 6-hour slope is
  undefined until 6 hours of history exist.
`.trim(),

  entry_3: `
Ventilation subsystem — power/airflow regression and residual (Figure 3):
- Fitted model: airflow = ${m.slope.toFixed(4)} · power ${m.intercept.toFixed(4)}
  (r² = ${m.r_squared}, fitted on ${m.n_rows_used} healthy rows).
- Model residual standard deviation: ${m.residual_sd}. Under healthy operation
  the relationship is very nearly deterministic.
- Fault threshold: residual < ${vt.threshold.toFixed(4)}.
  Healthy residual mean = ${vt.healthy_mean.toFixed(6)};
  faulty residual mean = ${vt.faulty_mean.toFixed(6)}.
  The threshold sits midway between two populations separated by roughly a full
  unit of residual.
- Baseline residual across the dataset: mean=-0.00109, std=0.01504. A residual
  around -0.02 is therefore ORDINARY (~1.4 std). The fault signature lives at
  the -0.5 to -1.0 scale.
- The regression is linear across the full observed load range. No curvature was
  fitted or required — r² = ${m.r_squared} leaves essentially no unexplained
  variance for a nonlinearity to hide in.
`.trim(),

  entry_4: `
Temperature onset / precursor test (Figure 5) — the notebook's headline
negative result:
- Question: is there any precursor signal in the 12 hours before a new fault
  begins, and does a t+6h classifier actually catch onset?
- Result: the classifier reaches 88.5% accuracy but catches 0 of 24 true
  onset-precursor rows. The accuracy is pure persistence — it scores well by
  predicting that current conditions continue, never by anticipating a
  transition.
- Temperature and airflow drop in the SAME hour. The drop is not lagged.
- Conclusion: temperature is not an early-warning signal, and onset in general
  is not forecastable from this data.
`.trim(),

  entry_5: `
Missingness audit (Figure 7):
- Total gap-filled rows: 6 out of 500 (is_gap_filled = true).
- Those 6 gaps scatter across the month with no clustering near incidents.
- Notebook verdict: UNSUPPORTED — gaps are not informative about incidents.
- Separately (Figure 1), sensor_source = "barry_j_" (50 of 500 rows) carries a
  measurable calibration offset on three channels:
    airflow_m3s        offset = +0.1499 (exact, via known-fault residual)
    water_pressure_kpa offset = +8.7229 (95% CI 4.70 to 12.74, p = 9.8e-05)
    water_flow_lps     offset = +0.0636 (95% CI 0.011 to 0.116, p = 0.021)
  This is a real data-quality finding, but it concerns sensor calibration, not
  gaps being predictive.
`.trim(),

  entry_2: `
sound_event vs system_status leakage check (Figure 4):
- Full cross-tabulation over all 500 rows:
    sound_event "normal" -> system_status "stable"   368 rows (all of them)
    sound_event "hum"    -> system_status "warning"    84 rows (all of them)
    sound_event "rattle" -> system_status "critical"   24 rows
    sound_event "rattle" -> system_status "failed"     24 rows
- Every health state maps to exactly one sound, zero off-diagonal entries at
  that level. The only ambiguity: "rattle" covers both degraded states
  (critical and failed) without separating them, so predicting exact
  system_status from sound alone scores 476/500 = 95.2%.
- Direction matters: sound_event carries no information system_status does not
  already carry, and it is recorded at the same timestamp — never earlier.
- Conclusion: sound_event is a redescription of system_status, not independent
  evidence. Using it as a detector would be label leakage.
`.trim(),
};

export const GENERAL_STATS = `
Dataset-wide context (Person A's eda.ipynb, 500 hourly rows, 2026-07-01 onward):
- Ventilation model: airflow = ${m.slope.toFixed(4)} · power ${m.intercept.toFixed(4)},
  r² = ${m.r_squared}, residual sd = ${m.residual_sd}, fitted on ${m.n_rows_used}
  healthy rows. Linear across the entire observed load range — no curvature was
  needed or fitted.
- Ventilation fault threshold: residual < ${vt.threshold.toFixed(4)}
  (healthy mean ${vt.healthy_mean.toFixed(6)}, faulty mean ${vt.faulty_mean.toFixed(6)}).
- Water escalation rule: ${esc.rule}, ~${esc.lead_time_hours_approx}h lead time,
  observed in ${esc.historical_base_rate.n_escalated} of
  ${esc.historical_base_rate.n_water_episodes} water episodes. Small sample —
  state as a count, not a probability.
- Baselines: residual mean=-0.00109 std=0.01504; water_pressure_kpa mean=350.41
  std=11.66; vibration_level mean=0.15022 std=0.02886.
- Episodes on record: 4 total — 2 water (both escalated), 2 ventilation
  (neither escalated).
- Onset is NOT forecastable: a t+6h classifier scores 88.5% accuracy while
  catching 0 of 24 true onset-precursor rows (pure persistence).
- sound_event is a redescription of system_status (leakage), not independent
  evidence.
- Data quality: 6 of 500 rows gap-filled, scattered, no clustering near
  incidents. 50 of 500 rows come from sensor_source "barry_j_", which carries
  known calibration offsets on airflow, water pressure and water flow.
`.trim();

export function getStatsForClaim(entryId?: string): string {
  const specific = entryId ? STATS_FOR_ENTRY[entryId] : undefined;
  return [specific, GENERAL_STATS].filter(Boolean).join("\n\n");
}
