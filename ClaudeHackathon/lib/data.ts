// Real data loader. Reads Person A's prepare_data.py output directly, so the
// watchers run against the same 500 rows the notebook analysed — no second
// copy of the data to drift out of sync.
//
// This replaces lib/fixtures.ts as the source for checkAllWatchers(). The
// fixtures module is retained only for the deterministic watcher tests.

import prepared from "../prepared_data.json";
import { Baseline, SensorRecord, WindowData } from "./types";

interface PreparedData {
  records: SensorRecord[];
  baseline: Baseline;
  derived_constants: DerivedConstants;
}

export interface DerivedConstants {
  airflow_model: {
    slope: number;
    intercept: number;
    r_squared: number;
    residual_sd: number;
    n_rows_used: number;
  };
  barry_j_offsets: Record<string, { offset: number; method: string; ci95?: number[]; p_value?: number }>;
  ventilation_threshold: { threshold: number; healthy_mean: number; faulty_mean: number };
  escalation: {
    rule: string;
    threshold_kpa_per_hour: number;
    sustained_hours: number;
    lead_time_hours_approx: number;
    historical_base_rate: { n_water_episodes: number; n_escalated: number; rate: number; note: string };
  };
  episodes: { start_ts: string; end_ts: string; subsystem: string; escalated: boolean }[];
  novelty_model: { threshold: number };
}

const DATA = prepared as unknown as PreparedData;

/** How many trailing hours of context a watcher window carries. */
export const WINDOW_HOURS = 24;

export const ALL_RECORDS: SensorRecord[] = [...DATA.records].sort((a, b) =>
  a.timestamp.localeCompare(b.timestamp)
);
export const BASELINE: Baseline = DATA.baseline;
export const DERIVED: DerivedConstants = DATA.derived_constants;

export const FIRST_TIMESTAMP = ALL_RECORDS[0].timestamp;
export const LAST_TIMESTAMP = ALL_RECORDS[ALL_RECORDS.length - 1].timestamp;

/**
 * Trailing window ending at (and including) `timestamp`. Never returns rows
 * after it — the replay scrubber must not be able to see its own future.
 *
 * This is the signature Person A's getWindow() was specified to have; the
 * watchers only ever call this.
 */
export function getWindow(timestamp: string, hours: number = WINDOW_HOURS): WindowData {
  const endIdx = ALL_RECORDS.findIndex((r) => r.timestamp === timestamp);
  if (endIdx === -1) {
    throw new Error(
      `No record at ${timestamp}. Data covers ${FIRST_TIMESTAMP} to ${LAST_TIMESTAMP} hourly.`
    );
  }
  const startIdx = Math.max(0, endIdx - (hours - 1));
  return {
    records: ALL_RECORDS.slice(startIdx, endIdx + 1),
    baseline: BASELINE,
  };
}

/** Every timestamp in order — the replay scrubber's track. */
export function allTimestamps(): string[] {
  return ALL_RECORDS.map((r) => r.timestamp);
}
