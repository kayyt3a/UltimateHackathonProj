import type { WatcherBundle } from "../types";

/**
 * Stand-in for Person B's `checkAllWatchers(timestamp)`, in exactly the shape
 * they publish. Delete once their watchers land — `lib/watchers-impl.ts` is the
 * swap point.
 *
 * EVERY NUMBER BELOW IS REAL. Sensor readings, pressure slopes and ventilation
 * residuals are copied from Person A's `prepared_data.json` on `main`, and the
 * firing/watching decisions apply their published rules:
 *
 *   Entry 1 (water)      pressure_slope_6h < -5 kPa/h
 *                          sustained 3 consecutive hours -> firing
 *                          crossed but not yet sustained  -> watching
 *   Entry 3 (ventilation) airflow residual < -0.5006      -> firing
 *   Entry 4               note REFUTED by the data ("cold arrives later" —
 *                          temperature and airflow drop in the same hour), so
 *                          it has no rule and never fires.
 *   Entry 5               note UNSUPPORTED (gaps scatter, no clustering), so
 *                          it has no rule and never fires.
 */

const LISTENER_VALIDATION = {
  entry: "Entry 2",
  accuracy_vs_system_status: 1.0,
  // Person A: sound_event maps 1:1 onto system_status, zero off-diagonal.
  note: "The young dragons' ears are exactly as accurate as the sensors — the rattle carries no information the sensors lack.",
};

const QUIET = (
  entry: string,
  subsystem: "water" | "ventilation" | null,
  reasoning: string,
) => ({ entry, status: "quiet" as const, subsystem, evidence: [], reasoning });

/** Entry 4 and Entry 5 have no rule — the data did not support the note. */
const ENTRY_4_QUIET = QUIET(
  "Entry 4",
  null,
  "No rule: 'cold arrives later' was refuted — temperature and airflow drop in the same hour, not lagged.",
);
const ENTRY_5_QUIET = QUIET(
  "Entry 5",
  null,
  "No rule: 'missing pieces' was unsupported — the 6 gaps scatter across the month with no clustering near incidents.",
);

/** 2026-07-04T23:00Z — one hour before the water episode begins. GREEN. */
const ALL_QUIET: WatcherBundle = {
  watchers: [
    QUIET("Entry 1", "water", "Pressure slope is +0.51 kPa/h; pressure steady at 343.9 kPa."),
    QUIET("Entry 3", "ventilation", "Airflow residual 0.0003, well inside the -0.5006 fault threshold."),
    ENTRY_4_QUIET,
    ENTRY_5_QUIET,
  ],
  listener_validation: LISTENER_VALIDATION,
};

/**
 * 2026-07-05T04:00Z — slope has crossed -5 but only for 2 hours, so the rule is
 * not yet sustained. AMBER. Escalation must NOT be predicted: Entry 1 is
 * watching, not firing.
 */
const WATER_WATCHING: WatcherBundle = {
  watchers: [
    {
      entry: "Entry 1",
      status: "watching",
      subsystem: "water",
      evidence: [
        {
          hour: "2026-07-05T04:00:00Z",
          signal: "pressure_slope_6h",
          value: -7.25,
          threshold: -5,
        },
      ],
      reasoning:
        "Pressure is falling at 7.25 kPa/h, past the -5 threshold, but only for 2 hours — the rule needs 3 consecutive hours.",
    },
    QUIET("Entry 3", "ventilation", "Airflow residual 0.0004; ventilation is healthy."),
    ENTRY_4_QUIET,
    ENTRY_5_QUIET,
  ],
  listener_validation: LISTENER_VALIDATION,
};

/**
 * 2026-07-05T06:00Z — the rule is now sustained and the shelter is still only
 * at "warning". RED, and the ONE case where escalation may be predicted. This
 * is the headline demo: the fault is caught with hours of warning left.
 */
const WATER_FIRING: WatcherBundle = {
  watchers: [
    {
      entry: "Entry 1",
      status: "firing",
      subsystem: "water",
      evidence: [
        {
          hour: "2026-07-05T06:00:00Z",
          signal: "pressure_slope_6h",
          value: -10.17,
          threshold: -5,
        },
        {
          hour: "2026-07-05T06:00:00Z",
          signal: "water_pressure_kpa",
          value: 291.35,
          threshold: 350.41,
        },
      ],
      reasoning:
        "Pressure has fallen at 10.17 kPa/h for 3 consecutive hours and is down to 291.4 kPa from a 350.4 kPa baseline.",
    },
    QUIET("Entry 3", "ventilation", "Airflow residual near zero; ventilation is healthy."),
    ENTRY_4_QUIET,
    ENTRY_5_QUIET,
  ],
  listener_validation: LISTENER_VALIDATION,
};

/**
 * 2026-07-06T00:00Z — the water system has already FAILED (67.6 kPa). RED.
 * Escalation is still permitted by the rule, but there is nothing left to
 * escalate to; the briefing should be about recovery, not warning.
 */
const WATER_FAILED: WatcherBundle = {
  watchers: [
    {
      entry: "Entry 1",
      status: "firing",
      subsystem: "water",
      evidence: [
        {
          hour: "2026-07-06T00:00:00Z",
          signal: "pressure_slope_6h",
          value: -16.92,
          threshold: -5,
        },
        {
          hour: "2026-07-06T00:00:00Z",
          signal: "water_pressure_kpa",
          value: 67.6,
          threshold: 350.41,
        },
      ],
      reasoning:
        "Pressure has collapsed to 67.6 kPa against a 350.4 kPa baseline, falling at 16.92 kPa/h. The tanks are effectively empty.",
    },
    QUIET("Entry 3", "ventilation", "Airflow residual 0.0001; ventilation is healthy."),
    ENTRY_4_QUIET,
    ENTRY_5_QUIET,
  ],
  listener_validation: LISTENER_VALIDATION,
};

/**
 * 2026-07-10T06:00Z — ventilation fault. RED, but escalation must be REFUSED
 * (both past ventilation episodes resolved on their own), and the disputed
 * ledger row about the rattle must be named.
 */
const VENT_FIRING: WatcherBundle = {
  watchers: [
    QUIET("Entry 1", "water", "Pressure slope is -3.83 kPa/h, inside the -5 threshold; water is healthy."),
    {
      entry: "Entry 3",
      status: "firing",
      subsystem: "ventilation",
      evidence: [
        {
          hour: "2026-07-10T06:00:00Z",
          signal: "airflow_residual",
          value: -1.0,
          threshold: -0.5006,
        },
        {
          hour: "2026-07-10T06:00:00Z",
          signal: "airflow_m3s",
          value: 3.74,
          threshold: 4.67,
        },
      ],
      reasoning:
        "Airflow is 1.0 m3/s below what the fan power predicts (airflow = 0.125 x power - 1.5, r2 = 0.999999). The fans are turning without moving air.",
    },
    ENTRY_4_QUIET,
    ENTRY_5_QUIET,
  ],
  listener_validation: LISTENER_VALIDATION,
};

/** Normalise so "2026-07-05T04:00Z" and "...T04:00:00.000Z" hit the same entry. */
const key = (ts: string) => new Date(ts).toISOString();

const BY_TIMESTAMP = new Map<string, WatcherBundle>([
  [key("2026-07-04T23:00:00Z"), ALL_QUIET],
  [key("2026-07-05T04:00:00Z"), WATER_WATCHING],
  [key("2026-07-05T06:00:00Z"), WATER_FIRING],
  [key("2026-07-06T00:00:00Z"), WATER_FAILED],
  [key("2026-07-10T06:00:00Z"), VENT_FIRING],
]);

/** Same signature as Person B's export. */
export async function checkAllWatchers(timestamp: string): Promise<WatcherBundle> {
  return structuredClone(BY_TIMESTAMP.get(key(timestamp)) ?? ALL_QUIET);
}

export const FIXTURES = {
  ALL_QUIET,
  WATER_WATCHING,
  WATER_FIRING,
  WATER_FAILED,
  VENT_FIRING,
  /** Kept as an alias so existing amber-path tests keep their meaning. */
  VENT_WATCHING: WATER_WATCHING,
};
