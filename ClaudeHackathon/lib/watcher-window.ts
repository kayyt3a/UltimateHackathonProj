// Boundary between Person A's data layer and Person B's watchers.
//
// Person A types `pressure_slope_6h` as `number | null` — honestly, because it
// is null for the first hours of the month, before a 6-hour window exists.
// Person B's watchers compare it numerically. Coercing here keeps both sides
// truthful: a MISSING slope becomes 0, which is "not falling", rather than
// being left null to compare as though it were.

import { getWindow as getWindowRaw } from "./data";
import type { WindowData } from "./types";

export function getWindow(timestamp: string, hoursBack = 24): WindowData {
  const { records, baseline } = getWindowRaw(timestamp, hoursBack);
  return {
    records: records.map((r) => ({
      ...r,
      pressure_slope_6h: typeof r.pressure_slope_6h === "number" ? r.pressure_slope_6h : 0,
      residual: typeof r.residual === "number" ? r.residual : 0,
    })),
    baseline: baseline as WindowData["baseline"],
  };
}
