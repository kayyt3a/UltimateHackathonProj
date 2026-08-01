# Person A — Data Pipeline + Analysis Notebook

Paste everything below into a fresh Claude Code session.

---

PROJECT: "Cloudy's Second Opinion" — a hackathon tool for dragons sheltering in
Reid Library after an attack damaged the building's power, water and ventilation
systems. Their late engineer Cloudy left 5 handwritten notes describing failure
patterns he noticed; nobody ever connected them to the sensor data on his old
computer. We build that link: 5 AI agents each watch the live feed for one of
Cloudy's patterns, and a 6th "Voice" agent writes a diagnosis in his voice when
something is actually wrong.

Stack: Next.js (App Router) + TypeScript for the app. Python + pandas +
matplotlib for the analysis work.

I AM PERSON A. I own two things: the exploratory data analysis that we present to
judges, and the production pipeline the agents consume. The organizers explicitly
told us the presentation must explain our data-science methods and show
visualisations of the analysis results — so the notebook is a graded deliverable,
not scratch work.

There is also a THIRD organizer hint: partway through, a newly powered-on section
of the library may surface archived maintenance records, partial old sensor logs
and unfinished repair notes — and this new information will sometimes contradict
Cloudy's notes, the current sensors, or the young dragons' observations. Judges
will ask: "how does your solution support good decision-making when new
information continuously becomes available and existing sources disagree?" My
pipeline needs to be built so a new, possibly-contradictory data source can be
dropped in without a redesign. See "PART 3" below for what that means for me.

MY INPUT: data/reid_library_sensor_data.csv — hourly readings, July 2026.
Columns: timestamp, power_kw, airflow_m3s, water_pressure_kpa, water_flow_lps,
temperature_c, vibration_level, sound_event (normal/hum/rattle), system_status
(stable/warning/critical/failed/recovering), sensor_source (original/barry_j_).
Known incidents to anchor analysis: July 5 and July 15 (plumbing collapse),
July 10 and July 18-19 (ventilation strain).

=== PART 1: ANALYSIS NOTEBOOK (/analysis/eda.ipynb) ===
Every step below must produce a labelled figure saved to /analysis/figures/ as
PNG. These go straight into the slide deck, so they need titles, axis labels and
legends — not raw default plots.

1. Calibration offset derivation.
   Split rows where system_status == "stable" by sensor_source. Compare the
   per-column distributions of original vs barry_j_ (power_kw, airflow_m3s,
   water_pressure_kpa, water_flow_lps, temperature_c, vibration_level). Report
   the mean difference per column and confirm it's a consistent additive offset
   rather than noise. Produce a before/after figure: overlaid histograms or box
   plots per column showing the two sources misaligned, then aligned after
   correction. State the offsets numerically in the notebook — we quote them on
   stage.

2. Baseline characterisation.
   Using stable rows only, compute mean and standard deviation for
   power_airflow_ratio, water_pressure_kpa and vibration_level. Plot each
   distribution with the ±1σ band marked. This defines "healthy."

3. Power-airflow regression (this is Cloudy's Entry 3 made rigorous).
   Cloudy wrote that healthy ventilation shows "a linear relationship between
   power and airflow." Fit a linear regression of airflow_m3s on power_kw using
   stable rows only. Report slope, intercept and R². Then compute residuals
   across the WHOLE dataset and plot them over time, with the four incident
   windows shaded. Ventilation strain should appear as a clear residual
   excursion. This turns a handwritten hunch into a fitted model — say that out
   loud in the presentation.

4. Sound-vibration correlation (Cloudy's Entry 2 — validating the young dragons
   who listen to the machinery).
   Group vibration_level by sound_event (normal / hum / rattle). Report group
   means and run a statistical test for difference (Kruskal-Wallis or one-way
   ANOVA). Plot as a box plot. The question we answer on stage: do the dragons'
   ears actually track a real physical signal? Quantify it.

5. LEAD-TIME ANALYSIS — the most important figure in the deck.
   For each of the four incidents, find the hour at which system_status first
   becomes "critical". Then, working backwards, find the first hour at which each
   signal crosses a meaningful threshold (e.g. 2σ from its stable baseline):
   water_pressure_kpa, water_flow_lps, power_airflow_ratio, vibration_level,
   sound_event changing away from "normal", and temperature_c. Compute lead time
   in hours for each signal, per incident. Plot as a grouped bar chart: signal on
   one axis, hours of advance warning on the other.
   The expected result — and our entire thesis — is that pressure, flow,
   vibration and sound give many hours of warning while temperature gives
   approximately zero or negative lead time. That single chart proves Cloudy's
   Entry 4 ("the cold arrives later") with numbers and justifies why the product
   exists. Make it clean.

6. Missingness analysis (Cloudy's Entry 5).
   Count nulls per column. Plot missingness over time. Test whether gaps cluster
   near incident windows versus occurring uniformly. If they cluster, that is
   evidence that sensor silence is itself predictive, which is exactly what
   Cloudy claimed.

Write a short markdown conclusion in the notebook: for each of Cloudy's five
notes, state whether the data supports it, with the specific number that shows
it. That summary becomes a slide.

=== PART 2: PRODUCTION PIPELINE (/lib/calibration.ts, /lib/signals.ts) ===
Port the validated findings into TypeScript for the live app.

1. CSV loader — parse into records sorted by timestamp.
2. Calibration fix — apply the offsets derived in Part 1 to all barry_j_ rows.
3. Gap handling — forward-fill nulls but set is_gap_filled: true on those
   records. Never hide a gap: a missing reading is itself one of Cloudy's five
   signals.
4. Derived signals on every record:
     power_airflow_ratio   = power_kw / airflow_m3s
     pressure_drop_rate_6h = (pressure_now - pressure_6h_ago) / 6
5. Baselines from stable rows only — mean and std for power_airflow_ratio,
   water_pressure_kpa, vibration_level.
6. Export getWindow(timestamp, hoursBack = 12).

EXACT OUTPUT SHAPE — locked, three teammates build against it right now:
```json
{
  "records": [
    { "timestamp": "2026-07-05T06:00:00Z",
      "power_kw": 47.04, "airflow_m3s": 4.38,
      "water_pressure_kpa": 291.351, "water_flow_lps": 1.732,
      "temperature_c": 18.677, "vibration_level": 0.33,
      "sound_event": "hum", "system_status": "warning",
      "sensor_source": "original", "is_gap_filled": false,
      "power_airflow_ratio": 10.74, "pressure_drop_rate_6h": -8.2 }
  ],
  "baseline": {
    "power_airflow_ratio": { "mean": 10.5, "std": 0.28 },
    "water_pressure_kpa": { "mean": 348, "std": 12.4 },
    "vibration_level": { "mean": 0.15, "std": 0.032 }
  }
}
```

=== PART 3: SOURCE TAGGING (for the third hint) ===
Restructure evidence generation so it's not hardcoded to "the CSV is the only
source." Instead, write a small "evidence provider" abstraction: a function that
returns a list of tagged observations, each shaped:
```json
{ "hour": "2026-07-05T04:00:00Z", "signal": "water_pressure_kpa",
  "value": 314.4, "baseline": 348, "source": "sensor" }
```
Right now you only have one provider ("sensor", from the CSV). Build it so that
adding a second provider later — e.g. "archived_record" once the organizers drop
that dataset — is just writing one more function with the same output shape, not
a redesign. This is what lets us say honestly on stage: "new information doesn't
require rearchitecting anything, it just becomes one more tagged source."

DELIVERABLE: the notebook with all six figures exported to /analysis/figures/,
the numeric findings written up in markdown, and the working TS module exporting
loadAllRecords(), getWindow(timestamp) and getBaseline(), with evidence already
shaped to carry a `source` field. Send the team the Barry J offsets, the baseline
numbers, the regression R² and the lead-time table as soon as you have them — the
whole presentation leans on those.
