// Real data loader for Person B's watchers.
//
// Replaces the hardcoded stand-in that shipped with the watchers while Person
// A's export was still pending. It reads their `prepared_data.json` (merged to
// main), so the watchers now run on the actual Reid Library sensor record
// rather than invented rows.
//
// The returned shape is unchanged — WindowData { records, baseline } — so
// lib/watchers-impl.ts did not need to change to accept it.

import { readFileSync } from "node:fs";
import path from "node:path";
import type { Baseline, SensorRecord, WindowData } from "./types";

const DATA_PATH =
  process.env.PREPARED_DATA_PATH ?? path.join(process.cwd(), "prepared_data.json");

interface PreparedData {
  records: Array<Record<string, unknown>>;
  baseline: Baseline;
}

let cached: WindowData | null = null;

function coerceRecord(raw: Record<string, unknown>): SensorRecord {
  const num = (key: string): number => {
    const value = raw[key];
    // pressure_slope_6h is null for the first hours of the month, before a
    // 6-hour window exists. A missing slope is not a falling slope, so it must
    // read as 0 rather than tripping a "< threshold" comparison.
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
  };
  const str = (key: string, fallback = ""): string =>
    typeof raw[key] === "string" ? (raw[key] as string) : fallback;

  return {
    timestamp: str("timestamp"),
    power_kw: num("power_kw"),
    airflow_m3s: num("airflow_m3s"),
    airflow_corrected: num("airflow_corrected"),
    water_pressure_kpa: num("water_pressure_kpa"),
    water_flow_lps: num("water_flow_lps"),
    temperature_c: num("temperature_c"),
    vibration_level: num("vibration_level"),
    sound_event: str("sound_event", "normal"),
    system_status: str("system_status", "stable"),
    sensor_source: str("sensor_source", "original"),
    is_gap_filled: raw.is_gap_filled === true,
    residual: num("residual"),
    pressure_slope_6h: num("pressure_slope_6h"),
  };
}

function load(): WindowData {
  if (cached) return cached;
  const parsed = JSON.parse(readFileSync(DATA_PATH, "utf8")) as PreparedData;
  const records = parsed.records
    .map(coerceRecord)
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  cached = { records, baseline: parsed.baseline };
  return cached;
}

/**
 * The full prepared record plus Person A's baseline stats.
 *
 * A TRAILING window ending at `timestamp`. This matters: Entry 5 scans the
 * window for gap-filled hours, so handing it the whole month made it report
 * every gap in July at every timestamp and pinned the traffic light above
 * green permanently. 24 hours is comfortably more than Entry 1's 3-hour
 * sustain requirement.
 */
export const WINDOW_LOOKBACK_HOURS = 24;

export function getWindow(timestamp: string): WindowData {
  const { records, baseline } = load();
  const end = new Date(timestamp).getTime();
  const start = end - WINDOW_LOOKBACK_HOURS * 3600_000;
  const window = records.filter((r) => {
    const t = new Date(r.timestamp).getTime();
    return t > start && t <= end;
  });
  // Never hand back an empty window: the watchers index into it by timestamp.
  return { records: window.length > 0 ? window : records, baseline };
}

/** Test seam — forces the next getWindow() to re-read from disk. */
export function resetWindowCache(): void {
  cached = null;
}

/**
 * Named hours from the real record, kept under the name Person B's
 * scripts/test-watchers.ts already imports. These replace the invented
 * fixture hours the hardcoded stand-in used.
 */
export const FIXTURE_TIMESTAMPS = {
  calm: "2026-07-04T23:00:00Z",
  entry1Firing: "2026-07-05T06:00:00Z",
  entry5Suspect: "2026-07-07T01:00:00Z",
  gapFilledPressure: "2026-07-02T01:00:00Z",
};

/**
 * The dataset's own spelling of an instant.
 *
 * Person B's watchers index records with an exact string compare, so
 * "2026-07-05T06:00:00.000Z" misses "2026-07-05T06:00:00Z" and throws. Callers
 * pass timestamps through here so equivalent spellings all resolve.
 */
export function canonicalTimestamp(timestamp: string): string {
  const target = new Date(timestamp).getTime();
  if (Number.isNaN(target)) return timestamp;
  const hit = load().records.find((r) => new Date(r.timestamp).getTime() === target);
  return hit ? hit.timestamp : timestamp;
}
