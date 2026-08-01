/**
 * Person A — data access layer.
 *
 * This module does NOT re-derive anything. Every number in prepared_data.json
 * was computed once by prepare_data.py; this file just loads it and slices it
 * by time. If you find yourself adding a calculation here, stop — it belongs
 * in prepare_data.py, not here, or you risk the Python and TS versions
 * drifting apart.
 *
 * Usage:
 *   import { loadAllRecords, getWindow, getBaseline, getDerivedConstants } from "@/lib/data";
 */

import fs from "fs";
import path from "path";

export interface SensorRecord {
  timestamp: string;
  power_kw: number;
  airflow_m3s: number;
  airflow_corrected: number;
  water_pressure_kpa: number;
  water_pressure_corrected: number;
  water_flow_lps: number;
  water_flow_corrected: number;
  temperature_c: number;
  vibration_level: number;
  sound_event: "normal" | "hum" | "rattle";
  system_status: "stable" | "warning" | "critical" | "failed";
  sensor_source: "original" | "barry_j_";
  is_gap_filled: boolean;
  residual: number;
  pressure_slope_6h: number | null;
  novelty_score?: number;
  is_novel?: boolean;
}

export interface BaselineStat {
  mean: number;
  std: number;
}

export interface Baseline {
  residual: BaselineStat;
  water_pressure_kpa: BaselineStat;
  vibration_level: BaselineStat;
}

export interface Episode {
  start_ts: string;
  end_ts: string;
  subsystem: "water" | "ventilation";
  escalated: boolean;
}

export interface DerivedConstants {
  airflow_model: {
    slope: number;
    intercept: number;
    r_squared: number;
    residual_sd: number;
    n_rows_used: number;
  };
  barry_j_offsets: Record<
    string,
    { offset: number; ci95?: [number, number]; p_value?: number; method: string }
  >;
  ventilation_threshold: {
    threshold: number;
    healthy_mean: number;
    faulty_mean: number;
  };
  escalation: {
    rule: string;
    threshold_kpa_per_hour: number;
    sustained_hours: number;
    lead_time_hours_approx: number;
    historical_base_rate: {
      n_water_episodes: number;
      n_escalated: number;
      rate: number | null;
      note: string;
    };
  };
  episodes: Episode[];
  novelty_model?: { threshold: number };
}

interface PreparedData {
  records: SensorRecord[];
  baseline: Baseline;
  derived_constants: DerivedConstants;
}

let _cache: PreparedData | null = null;

/**
 * Locates prepared_data.json relative to the project root and caches it in
 * memory after the first read — this file doesn't change at runtime, so
 * there's no reason to hit disk on every call.
 */
function loadRaw(): PreparedData {
  if (_cache) return _cache;
  const candidates = [
    path.join(process.cwd(), "prepared_data.json"),
    path.join(process.cwd(), "..", "prepared_data.json"),
    path.join(process.cwd(), "data", "prepared_data.json"),
  ];
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) {
    throw new Error(
      `prepared_data.json not found. Checked: ${candidates.join(", ")}. ` +
        `Run prepare_data.py first, or copy its output into the project root.`
    );
  }
  const raw = fs.readFileSync(found, "utf-8");
  _cache = JSON.parse(raw) as PreparedData;
  return _cache;
}

/** All 500 hourly records, sorted by timestamp ascending. */
export function loadAllRecords(): SensorRecord[] {
  return loadRaw().records;
}

/** Baseline mean/std over stable hours — for chart shading. */
export function getBaseline(): Baseline {
  return loadRaw().baseline;
}

/**
 * Every derived constant: the regression fit, Barry J offsets, thresholds,
 * the escalation rule and its historical base rate, the four episodes.
 * Read from here instead of hardcoding a threshold anywhere downstream —
 * e.g. watchers.ts should read ventilation_threshold.threshold, not a
 * typed-in -0.5.
 */
export function getDerivedConstants(): DerivedConstants {
  return loadRaw().derived_constants;
}

/**
 * Records from (timestamp - hoursBack) through timestamp, inclusive of the
 * end, plus the baseline. Used by watchers (small window, recent evidence)
 * and the chart (larger window — Person D uses 48h).
 */
export function getWindow(
  timestamp: string,
  hoursBack: number = 12
): { records: SensorRecord[]; baseline: Baseline } {
  const all = loadAllRecords();
  const targetMs = new Date(timestamp).getTime();
  const startMs = targetMs - hoursBack * 60 * 60 * 1000;
  const records = all.filter((r) => {
    const t = new Date(r.timestamp).getTime();
    return t > startMs && t <= targetMs;
  });
  return { records, baseline: getBaseline() };
}

/**
 * The single record at, or nearest before, a given timestamp. Useful for
 * the aggregator/watchers checking "what's the current state right now."
 */
export function getRecordAt(timestamp: string): SensorRecord | null {
  const all = loadAllRecords();
  const targetMs = new Date(timestamp).getTime();
  let best: SensorRecord | null = null;
  for (const r of all) {
    if (new Date(r.timestamp).getTime() <= targetMs) best = r;
    else break;
  }
  return best;
}

/** The full list of demo timestamps, for quick-jump buttons and cache pre-warming. */
export function getTimestampRange(): { min: string; max: string } {
  const all = loadAllRecords();
  return { min: all[0].timestamp, max: all[all.length - 1].timestamp };
}
