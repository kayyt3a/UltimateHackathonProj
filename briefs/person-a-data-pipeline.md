# Person A — Data Pipeline + Analysis Notebook

Paste everything below into a fresh Claude Code session.

---

PROJECT: "Cloudy's Second Opinion" — Reid Library's late engineer Cloudy left 5
handwritten notes describing failure patterns; nobody ever connected them to
his sensor data. We tested every note against the real CSV. Three of five were
wrong or misleading. The two that held up power a live diagnosis tool; a
Reconciliation Agent lets new, possibly-contradicting documents be tested the
same way, live, in front of judges.

Stack: Next.js (App Router) + TypeScript for the app. Python + pandas +
matplotlib for the analysis work.

I AM PERSON A. I own the exploratory analysis presented to judges AND the
production pipeline. Organizers explicitly require our data-science method
shown with visualisations — the notebook is a graded deliverable, not scratch
work.

MY INPUT: data/reid_library_sensor_data.csv — hourly readings, July 2026.
Columns: timestamp, power_kw, airflow_m3s, water_pressure_kpa, water_flow_lps,
temperature_c, vibration_level, sound_event (normal/hum/rattle), system_status
(stable/warning/critical/failed/recovering), sensor_source (original/barry_j_).

VERIFIED GROUND TRUTH — use these, don't re-derive from scratch, but confirm
them against the CSV as your first step:

```
airflow_m3s = 0.125 * power_kw - 1.5      r² = 0.999999
residual = airflow_corrected - (0.125 * power_kw - 1.5)
  ≈  0.000  ventilation healthy
  ≈ -1.000  ventilation fault
```

Barry J offsets (subtract from barry_j_ rows, from 2026-07-19 18:00 onward):
airflow_m3s +0.1496 (exact), water_pressure_kpa +8.73, water_flow_lps +0.063.
Power, temperature, vibration: no significant offset.

Four episodes: 2026-07-05 00:00 (water, 36h, escalates to failed), 2026-07-10
04:00 (ventilation, 30h, resolves), 2026-07-15 00:00 (water, 36h, escalates to
failed), 2026-07-18 22:00 (ventilation, 30h, resolves).

Escalation rule (water only): `pressure_slope_6h < -5 kPa/h` sustained 3h →
predicts escalation to failure, ~8h lead time, validated on n=2.

=== PART 1: ANALYSIS NOTEBOOK (/analysis/eda.ipynb) ===
Every step produces a labelled figure saved to /analysis/figures/ as PNG —
titled, axis-labelled, legended. These go straight into the slide deck.

1. Calibration offset derivation. Split stable rows by sensor_source, compare
   per-column means (power_kw, airflow_m3s, water_pressure_kpa, water_flow_lps,
   temperature_c, vibration_level), confirm the offsets above are consistent
   additive shifts. Figure: before/after overlaid histograms per column.

2. Baseline distributions. Mean/std of residual, water_pressure_kpa,
   vibration_level over stable rows only, with ±1σ bands plotted.

3. Power-airflow regression + residual analysis (Entry 3, made rigorous).
   Fit airflow_m3s ~ power_kw on stable rows, report slope/intercept/R².
   Compute residual across the WHOLE dataset, plot over time with the four
   incident windows shaded. Ventilation strain should show as a clean
   excursion to ≈ -1.0.

4. Sound vs system_status correlation — THE LEAKAGE CHECK (Entry 2). Cross-tab
   sound_event against system_status. Expect a 1:1 mapping with zero
   off-diagonal entries — this proves sound_event is a redescription of the
   ground-truth label, not independent evidence. Figure: confusion matrix.
   This finding is why Entry 2 must NEVER feed the severity aggregator — flag
   this loudly to Person B and Person D so nobody accidentally wires it in.

5. Onset-predictability test — the most important negative result. For each
   of the four episodes, take the 12h immediately before onset and check
   whether any signal (power, airflow, pressure, flow, temp, vibration,
   residual, pressure_slope_6h) deviates meaningfully from its stable
   baseline. Also fit a simple classifier predicting system_status at t+6h
   from current features and report accuracy AND how many of the 4 onset
   transitions it actually catches (expect ~85% accuracy from persistence
   alone, 0/4 true onset catches — or close to it; confirm on this dataset).
   Figure: precursor signal plotted flat against noise floor in the pre-onset
   window. This proves onset is NOT forecastable — say so plainly in the
   notebook, it's a finding, not a failure.

6. Escalation lead-time analysis — scoped correctly, only the water episodes.
   For the 2 water episodes, plot pressure_slope_6h through the warning phase:
   escalating episodes should show monotonic decline (~353→240 kPa over 12h);
   compare against the 2 ventilation episodes' pressure behavior (should stay
   flat, since pressure isn't the affected subsystem there). State plainly:
   n=2, the rule separates cleanly by about hour 4 of warning, giving ~8h lead
   time before critical.

7. Missingness analysis (Entry 5). Count and plot nulls over time. Confirm
   whether they cluster near incidents or scatter uniformly (expect scatter,
   n≈6 — too sparse to be informative). This finding is why Entry 5 gets
   repurposed as a calibration/sensor-integrity watcher rather than a
   gap-as-signal watcher — tell Person B this explicitly.

Write a short markdown conclusion: for each of Cloudy's five notes, state the
verdict (supported/refuted/untestable/redundant) with the specific number that
proves it. This becomes a slide.

=== PART 2: PRODUCTION PIPELINE (/lib/calibration.ts, /lib/signals.ts) ===
Port the validated findings into TypeScript.

1. CSV loader — records sorted by timestamp.
2. Calibration fix — apply the verified offsets to barry_j_ rows.
3. Gap handling — forward-fill nulls, set is_gap_filled: true (feeds the
   Entry 5 integrity watcher, doesn't need to be "informative" on its own).
4. Derived signals per record:
   - `residual = airflow_corrected - (0.125 * power_kw - 1.5)`
   - `pressure_slope_6h = (pressure_now - pressure_6h_ago) / 6`
5. Baselines from stable rows only — mean/std for residual, water_pressure_kpa,
   vibration_level (used for chart shading, NOT for watcher thresholds — the
   watcher thresholds are the fixed constants above, not baseline-relative).
6. Export getWindow(timestamp, hoursBack = 12).

EXACT OUTPUT SHAPE — locked, three teammates build against this:
```json
{
  "records": [
    { "timestamp": "2026-07-05T06:00:00Z",
      "power_kw": 47.04, "airflow_m3s": 4.38, "airflow_corrected": 4.38,
      "water_pressure_kpa": 291.351, "water_flow_lps": 1.732,
      "temperature_c": 18.677, "vibration_level": 0.33,
      "sound_event": "hum", "system_status": "warning",
      "sensor_source": "original", "is_gap_filled": false,
      "residual": -0.021, "pressure_slope_6h": -9.4 }
  ],
  "baseline": {
    "residual": { "mean": 0.0, "std": 0.0006 },
    "water_pressure_kpa": { "mean": 348, "std": 12.4 },
    "vibration_level": { "mean": 0.15, "std": 0.032 }
  }
}
```

DELIVERABLE: notebook with all seven figures in /analysis/figures/, the
markdown verdict summary, and the working TS module exporting
loadAllRecords(), getWindow(timestamp), getBaseline(). Send the team the
confirmed offsets, regression R², and the onset-test result and escalation
lead-time numbers as soon as you have them — the presentation and Person C's
Voice prompt both depend on the exact numbers.
