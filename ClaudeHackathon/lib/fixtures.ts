// Stand-in for Person A's getWindow(timestamp). Hardcoded until their export
// lands — same shape as the contract in the project brief. Swap this module
// out for the real data loader without touching watchers.ts.

import { SensorRecord, WindowData } from "./types";

const BASELINE: WindowData["baseline"] = {
  residual: { mean: 0.0, std: 0.0006 },
  water_pressure_kpa: { mean: 348, std: 12.4 },
  vibration_level: { mean: 0.15, std: 0.032 },
};

function record(partial: Partial<SensorRecord> & { timestamp: string }): SensorRecord {
  return {
    power_kw: 46.5,
    airflow_m3s: 4.4,
    airflow_corrected: 4.4,
    water_pressure_kpa: 348,
    water_pressure_corrected: 348,
    water_flow_lps: 1.74,
    water_flow_corrected: 1.74,
    temperature_c: 18.6,
    vibration_level: 0.15,
    sound_event: "hum",
    system_status: "warning",
    sensor_source: "original",
    is_gap_filled: false,
    residual: 0.0002,
    pressure_slope_6h: 0.1,
    novelty_score: -0.99,
    is_novel: false,
    ...partial,
  };
}

// All-quiet window: 2026-07-04T09:00Z - 12:00Z. Nothing near any threshold.
const CALM_WINDOW: WindowData = {
  records: [
    record({ timestamp: "2026-07-04T09:00:00Z", pressure_slope_6h: 0.3, residual: -0.0001 }),
    record({ timestamp: "2026-07-04T10:00:00Z", pressure_slope_6h: 0.1, residual: 0.0003 }),
    record({ timestamp: "2026-07-04T11:00:00Z", pressure_slope_6h: 0.2, residual: -0.0002 }),
    record({
      timestamp: "2026-07-04T12:00:00Z",
      pressure_slope_6h: 0.15,
      residual: 0.0001,
      temperature_c: 18.61,
    }),
  ],
  baseline: BASELINE,
};

// Entry 1 firing window: pressure_slope_6h < -5 for three straight hours
// ending 06:00, matching the worked example in the project brief. Residual
// stays nowhere near the -0.5 ventilation threshold, so Entry 3 stays quiet.
const ENTRY1_FIRING_WINDOW: WindowData = {
  records: [
    record({
      timestamp: "2026-07-05T03:00:00Z",
      pressure_slope_6h: -1.8,
      residual: -0.015,
      water_pressure_kpa: 320,
      system_status: "warning",
      sound_event: "hum",
      temperature_c: 18.7,
    }),
    record({
      timestamp: "2026-07-05T04:00:00Z",
      pressure_slope_6h: -6.1,
      residual: -0.018,
      water_pressure_kpa: 309,
      system_status: "warning",
      sound_event: "hum",
      temperature_c: 18.68,
    }),
    record({
      timestamp: "2026-07-05T05:00:00Z",
      pressure_slope_6h: -7.8,
      residual: -0.02,
      water_pressure_kpa: 299,
      system_status: "warning",
      sound_event: "hum",
      temperature_c: 18.72,
    }),
    record({
      timestamp: "2026-07-05T06:00:00Z",
      pressure_slope_6h: -9.4,
      residual: -0.021,
      water_pressure_kpa: 291.351,
      water_flow_lps: 1.732,
      airflow_m3s: 4.38,
      airflow_corrected: 4.38,
      vibration_level: 0.33,
      system_status: "warning",
      sound_event: "hum",
      temperature_c: 18.677,
    }),
  ],
  baseline: BASELINE,
};

// Entry 5 probe window: gap-filled record from the barry_j_ source with an
// uncorrected airflow reading, to exercise the data-integrity watcher.
const ENTRY5_SUSPECT_WINDOW: WindowData = {
  records: [
    record({ timestamp: "2026-07-06T01:00:00Z", sensor_source: "original" }),
    record({
      timestamp: "2026-07-06T02:00:00Z",
      sensor_source: "barry_j_",
      is_gap_filled: true,
      airflow_m3s: 4.1,
      airflow_corrected: 4.1, // no calibration correction applied
    }),
    record({
      timestamp: "2026-07-06T03:00:00Z",
      sensor_source: "barry_j_",
      is_gap_filled: true,
      airflow_m3s: 4.05,
      airflow_corrected: 4.05,
    }),
    record({
      timestamp: "2026-07-06T04:00:00Z",
      sensor_source: "barry_j_",
      is_gap_filled: true,
      airflow_m3s: 4.0,
      airflow_corrected: 4.0,
    }),
  ],
  baseline: BASELINE,
};

// Same pressure collapse as ENTRY1_FIRING_WINDOW, but the hours driving it are
// interpolated rather than measured. Entry 1 should hold at "watching" instead
// of firing — alarming on data nobody recorded is how you lose an audience's
// trust mid-demo.
const GAP_FILLED_PRESSURE_WINDOW: WindowData = {
  records: [
    record({ timestamp: "2026-07-07T03:00:00Z", pressure_slope_6h: -1.5 }),
    record({ timestamp: "2026-07-07T04:00:00Z", pressure_slope_6h: -6.1, is_gap_filled: true }),
    record({ timestamp: "2026-07-07T05:00:00Z", pressure_slope_6h: -7.8, is_gap_filled: true }),
    record({ timestamp: "2026-07-07T06:00:00Z", pressure_slope_6h: -9.4 }),
  ],
  baseline: BASELINE,
};

const WINDOWS: Record<string, WindowData> = {
  "2026-07-04T12:00:00Z": CALM_WINDOW,
  "2026-07-05T06:00:00Z": ENTRY1_FIRING_WINDOW,
  "2026-07-06T04:00:00Z": ENTRY5_SUSPECT_WINDOW,
  "2026-07-07T06:00:00Z": GAP_FILLED_PRESSURE_WINDOW,
};

/**
 * Stand-in for Person A's getWindow(timestamp). Returns the fixture window
 * ending at `timestamp`. Throws for unknown timestamps rather than silently
 * returning empty data.
 */
export function getWindow(timestamp: string): WindowData {
  const window = WINDOWS[timestamp];
  if (!window) {
    throw new Error(
      `No fixture window for ${timestamp}. Known fixtures: ${Object.keys(WINDOWS).join(", ")}`
    );
  }
  return window;
}

export const FIXTURE_TIMESTAMPS = {
  calm: "2026-07-04T12:00:00Z",
  entry1Firing: "2026-07-05T06:00:00Z",
  entry5Suspect: "2026-07-06T04:00:00Z",
  gapFilledPressure: "2026-07-07T06:00:00Z",
};
