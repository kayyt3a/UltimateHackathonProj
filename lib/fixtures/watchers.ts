import type { WatcherBundle } from "../types";

/**
 * Hardcoded stand-in for Person B's `checkAllWatchers(timestamp)`, in exactly
 * the shape they publish. Delete this once `lib/watchers-impl.ts` lands — the
 * adapter in `lib/watchers.ts` prefers the real implementation automatically.
 *
 * Scenarios are chosen to exercise every branch of the honesty rules across the
 * four pre-warmed demo timestamps.
 */

const LISTENER_VALIDATION = {
  entry: "Entry 2",
  accuracy_vs_system_status: 1.0,
  note: "The young dragons' ears are exactly as accurate as the sensors.",
};

const QUIET = (entry: string, subsystem: "water" | "ventilation" | null, reasoning: string) => ({
  entry,
  status: "quiet" as const,
  subsystem,
  evidence: [],
  reasoning,
});

/** 2026-07-04T23:00Z — everything calm. severity: green, no Voice call. */
const ALL_QUIET: WatcherBundle = {
  watchers: [
    QUIET("Entry 1", "water", "Pressure slope is -0.4 kPa/h, well inside the -5 threshold."),
    QUIET("Entry 3", "ventilation", "East vent airflow steady at 94% of nominal."),
    QUIET("Entry 4", "water", "Refill cycles averaging 61 minutes; no short-cycling."),
    QUIET("Entry 5", null, "No cross-subsystem correlation above threshold."),
  ],
  listener_validation: LISTENER_VALIDATION,
};

/**
 * 2026-07-05T04:00Z — Entry 1 firing on water with the pressure-slope rule.
 * severity: red, and the ONE case where escalation may be predicted.
 */
const WATER_FIRING: WatcherBundle = {
  watchers: [
    {
      entry: "Entry 1",
      status: "firing",
      subsystem: "water",
      evidence: [
        {
          hour: "2026-07-05T04:00:00Z",
          signal: "pressure_slope_6h",
          value: -9.4,
          threshold: -5,
        },
      ],
      reasoning: "Pressure has fallen at 9.4 kPa/h for the last 3 hours.",
    },
    QUIET("Entry 3", "ventilation", "East vent airflow steady at 91% of nominal."),
    {
      entry: "Entry 4",
      status: "watching",
      subsystem: "water",
      evidence: [
        {
          hour: "2026-07-05T04:00:00Z",
          signal: "refill_cycle_minutes",
          value: 44,
          threshold: 40,
        },
      ],
      reasoning: "Refill cycles have shortened to 44 minutes, close to the 40 minute leak threshold.",
    },
    QUIET("Entry 5", null, "No cross-subsystem correlation above threshold."),
  ],
  listener_validation: LISTENER_VALIDATION,
};

/** 2026-07-06T00:00Z — ventilation watching only. severity: amber. */
const VENT_WATCHING: WatcherBundle = {
  watchers: [
    QUIET("Entry 1", "water", "Pressure slope recovered to -1.1 kPa/h after the valve reseat."),
    {
      entry: "Entry 3",
      status: "watching",
      subsystem: "ventilation",
      evidence: [
        {
          hour: "2026-07-06T00:00:00Z",
          signal: "vent_rattle_db",
          value: 47,
          threshold: 45,
        },
      ],
      reasoning: "East vent rattle at 47 dB, just over the 45 dB threshold.",
    },
    QUIET("Entry 4", "water", "Refill cycles averaging 58 minutes."),
    QUIET("Entry 5", null, "No cross-subsystem correlation above threshold."),
  ],
  listener_validation: LISTENER_VALIDATION,
};

/**
 * 2026-07-10T06:00Z — Entry 3 firing on ventilation. severity: red, but
 * escalation must NOT be predicted, and the disputed ledger row L-003 must be
 * named. This is the case that catches a hallucinating Voice agent.
 */
const VENT_FIRING: WatcherBundle = {
  watchers: [
    QUIET("Entry 1", "water", "Pressure slope is -0.9 kPa/h; water is healthy."),
    {
      entry: "Entry 3",
      status: "firing",
      subsystem: "ventilation",
      evidence: [
        {
          hour: "2026-07-10T06:00:00Z",
          signal: "vent_rattle_db",
          value: 58,
          threshold: 45,
        },
        {
          hour: "2026-07-10T06:00:00Z",
          signal: "airflow_pct_nominal",
          value: 62,
          threshold: 70,
        },
      ],
      reasoning: "East vent rattle at 58 dB and airflow down to 62% of nominal.",
    },
    QUIET("Entry 4", "water", "Refill cycles averaging 63 minutes."),
    QUIET("Entry 5", null, "No cross-subsystem correlation above threshold."),
  ],
  listener_validation: LISTENER_VALIDATION,
};

/** Normalise so "2026-07-05T04:00Z" and "...T04:00:00.000Z" hit the same entry. */
const key = (ts: string) => new Date(ts).toISOString();

const BY_TIMESTAMP = new Map<string, WatcherBundle>([
  [key("2026-07-04T23:00:00Z"), ALL_QUIET],
  [key("2026-07-05T04:00:00Z"), WATER_FIRING],
  [key("2026-07-06T00:00:00Z"), VENT_WATCHING],
  [key("2026-07-10T06:00:00Z"), VENT_FIRING],
]);

/** Same signature as Person B's export. */
export async function checkAllWatchers(timestamp: string): Promise<WatcherBundle> {
  return structuredClone(BY_TIMESTAMP.get(key(timestamp)) ?? ALL_QUIET);
}

export const FIXTURES = {
  ALL_QUIET,
  WATER_FIRING,
  VENT_WATCHING,
  VENT_FIRING,
};
