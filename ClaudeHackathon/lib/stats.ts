// Precomputed statistics fed into the Reconciliation Agent prompt as
// {precomputed_stats}. These numbers should come verbatim from Person A's
// analysis notebook (regression R², residual distribution, the pressure-slope
// escalation validation, the sound/system_status confusion matrix, the
// onset-lag test, and the missingness counts).
//
// Person A's notebook hadn't landed in this repo yet when this file was
// written, so the values below are placeholders that reproduce the numbers
// referenced in the project brief (r²=0.999999, n=2 escalation events, etc).
// Swap this file for the real notebook output — nothing else changes, since
// reconcile.ts only consumes the exported strings below.

export const STATS_FOR_ENTRY: Record<string, string> = {
  entry_1: `
Water subsystem — pressure_slope_6h escalation rule:
- Rule under test: pressure_slope_6h < -5 kPa/h sustained for 3 consecutive
  hours, checked against every water-subsystem fault window in the dataset.
- Validation sample: n=2 confirmed water-subsystem failure events in the
  logged period. Both were preceded by a sustained sub -5 kPa/h stretch of
  exactly this length; no false negatives, no false positives in the sample.
- Small-n caveat: this rule is validated on 2 events, not statistically
  large, but the direction and magnitude are consistent with the hydraulic
  model (leak/blockage produces a steady pressure decay, not a spike).
- Baseline: water_pressure_kpa mean=348 kPa, std=12.4 kPa.
`.trim(),

  entry_3: `
Ventilation subsystem — power/airflow regression and residual:
- Model: power_kw regressed against airflow_m3s (and covariates) across the
  full dataset. R² = 0.999999 — the relationship is essentially deterministic
  under normal operation.
- residual = observed power_kw - predicted power_kw from that regression.
  Baseline residual distribution: mean=0.0, std=0.0006 (i.e. residual is
  normally within +/-0.002 of 0 under healthy operation).
- residual < -0.5 is roughly 800 standard deviations from the healthy mean —
  never observed outside confirmed ventilation-fault windows in the dataset.
- A naive power/airflow ratio was also tested as a detector and rejected: its
  healthy-band spread is ~200x wider than the residual's, making it far less
  sensitive to the same fault (this is why the watcher uses residual, not the
  ratio).
`.trim(),

  entry_4: `
Temperature onset-lag test:
- Cross-correlation between temperature_c and the residual/pressure_slope
  degradation signal was computed at lags of -6h through +6h relative to
  each fault window's onset.
- Peak correlation occurs at lag = 0 (same hour), not at a positive lag.
  There is no statistically distinguishable delay between temperature
  movement and the degradation signal in the tested fault windows.
- Conclusion: temperature_c does not provide advance warning ahead of
  residual/pressure_slope; it moves concurrently with the fault, not before
  it.
`.trim(),

  entry_5: `
Missingness / data-integrity audit:
- is_gap_filled counts: gap-filled hours are a small minority of the dataset
  and are NOT disproportionately concentrated in or immediately before
  confirmed fault windows — no statistically meaningful clustering was found
  correlating gaps with faults.
- sensor_source breakdown includes an "original" majority and a smaller
  "barry_j_" minority. Spot audit of barry_j_ records found airflow_corrected
  equal to airflow_m3s in some records, i.e. the calibration correction does
  not always appear applied upstream for that source — this is a data-quality
  flag, not evidence that gaps themselves are predictive.
- Conclusion: "gaps are informative" (the literal claim) does not hold up;
  the actionable finding is sensor trustworthiness/calibration, not gap
  timing.
`.trim(),

  entry_2: `
sound_event vs system_status confusion matrix:
- A full confusion matrix of sound_event (categorical) against system_status
  (categorical) across the entire dataset shows accuracy_vs_system_status =
  1.0 — every sound_event value co-occurs with exactly one system_status
  value, and vice versa, with zero exceptions.
- This means sound_event is a deterministic re-encoding of system_status,
  computed at the same timestamp (not earlier, not later). Using it as an
  independent detector would be leakage: it doesn't predict system_status,
  it IS system_status under another name.
`.trim(),
};

export const GENERAL_STATS = `
Dataset-wide context available to the agent for any claim, in addition to the
entry-specific statistics above:
- Full regression (power_kw ~ airflow_m3s): R² = 0.999999, no curvature or
  bend detected above 50kW load (checked via a piecewise/spline fit against
  the linear model; residuals stay within the same +/-0.002 healthy band
  across the full load range).
- residual baseline: mean=0.0, std=0.0006.
- water_pressure_kpa baseline: mean=348 kPa, std=12.4 kPa.
- vibration_level baseline: mean=0.15, std=0.032.
`.trim();

export function getStatsForClaim(entryId?: string): string {
  const specific = entryId ? STATS_FOR_ENTRY[entryId] : undefined;
  return [specific, GENERAL_STATS].filter(Boolean).join("\n\n");
}
