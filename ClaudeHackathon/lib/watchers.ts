// Deterministic watchers — plain code, no LLM. Cheap enough to run on every
// tick of the replay scrubber. Four active watchers feed the aggregator;
// Entry 2 is computed separately as listener_validation (see brief: using
// sound_event as a detector is leakage, since it maps 1:1 onto system_status).

// Thresholds come straight from Person A's derived constants — never hardcoded.
import { getDerivedConstants } from "./data";
// ...but the window comes through the adapter, which coerces Person A's honestly
// nullable pressure_slope_6h/residual to numbers before these watchers compare
// them. Reading ./data directly here crashes on the first hours of the month.
import { getWindow } from "./watcher-window";
import {
  ListenerValidation,
  SensorRecord,
  WatcherEvidence,
  WatcherReport,
  WatcherResult,
  WatcherStatus,
  WindowData,
} from "./types";

// Thresholds come from Person A's notebook via prepared_data.json wherever the
// notebook actually derives them — see their handoff §"read from here instead
// of hardcoding a threshold". Only values the notebook does NOT derive are
// literals below, and each carries the measurement that justifies it.
const DERIVED_CONSTANTS = getDerivedConstants();

const PRESSURE_FIRING_THRESHOLD = DERIVED_CONSTANTS.escalation.threshold_kpa_per_hour; // -5
const PRESSURE_SUSTAIN_HOURS = DERIVED_CONSTANTS.escalation.sustained_hours; // 3

// Entry 1 "watching" floor. Was -2, which Person A measured as flagging 72 of
// 363 stable hours (20%) — the stable slope is far noisier than expected
// (std 9.74, p95 +6.06). -4.31 is the 5th percentile of stable slope, so this
// is a measured floor rather than a guess.
const PRESSURE_WATCHING_THRESHOLD = -4.31;

// Entry 3 firing threshold, fit by the notebook midway between the healthy and
// faulty residual populations (-0.5006). 60 firing hours, all inside the two
// ventilation episodes, zero false positives across 438 healthy hours.
const RESIDUAL_FIRING_THRESHOLD = DERIVED_CONSTANTS.ventilation_threshold.threshold;

// Buffer zone. Person A confirmed no real record lands in this band — residual
// is cleanly bimodal — so on live data Entry 3 only ever reads quiet or firing.
// Kept for the fixture tests; don't plan to demo it.
const RESIDUAL_WATCHING_THRESHOLD = -0.25;

// The honest healthy noise floor for residual. NOT baseline.residual.std:
// that reads 0.01504, inflated ~50x by two gap-filled interpolation artifacts.
// The regression's own residual SD (0.000298, fit on 326 clean rows) is the
// real spread — using the baseline figure understated Entry 3's sigma distance
// by roughly 50x.
const RESIDUAL_HEALTHY_SD = DERIVED_CONSTANTS.airflow_model.residual_sd;

// Temperature move that counts as real rather than noise. Was 0.02, which
// Person A measured as BELOW the noise floor — 360 of 363 stable hours move
// at least that much, so Entry 4 was firing on noise and reaching the right
// conclusion for the wrong reason. Median |dT| is 0.44 C/h with sigma 0.66;
// 1.3 is ~2 sigma, an actual "temperature moved" test.
const TEMP_MOVEMENT_EPSILON = 1.3;

const GAP_CLUSTER_THRESHOLD = 3; // consecutive gap-filled hours considered "clustering"

function sortedRecords(records: SensorRecord[]): SensorRecord[] {
  return [...records].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

function indexOfTimestamp(records: SensorRecord[], timestamp: string): number {
  const idx = records.findIndex((r) => r.timestamp === timestamp);
  if (idx === -1) {
    throw new Error(`Window does not contain a record at ${timestamp}`);
  }
  return idx;
}

/**
 * Records at or before `timestamp`. Entry 5 previously scanned the whole
 * window, which would let it report on hours the replay scrubber hasn't
 * reached yet if Person A's getWindow() ever returns a centred (rather than
 * trailing) window. Everything downstream of this reads only the past.
 */
function recordsUpTo(records: SensorRecord[], timestamp: string): SensorRecord[] {
  return records.filter((r) => r.timestamp <= timestamp);
}

/**
 * Downgrades a firing verdict to "watching" when the record that triggered it
 * was interpolated rather than measured. Firing on gap-filled data means
 * alarming on a number nobody actually observed — Entry 5 flags the data
 * quality separately, but the fault watchers shouldn't assert on it either.
 */
function downgradeIfGapFilled(
  status: WatcherStatus,
  deciding: SensorRecord[],
  reasoning: string
): { status: WatcherStatus; reasoning: string } {
  if (status !== "firing" || !deciding.some((r) => r.is_gap_filled)) {
    return { status, reasoning };
  }
  return {
    status: "watching",
    reasoning: `${reasoning} Held at "watching" rather than "firing": some of these hours are gap-filled, so this is interpolated data, not measured.`,
  };
}

// --- Entry 1: pipes complain first (SUPPORTED) ---

function checkEntry1(window: WindowData, timestamp: string): WatcherResult {
  const records = sortedRecords(window.records);
  const idx = indexOfTimestamp(records, timestamp);
  const current = records[idx];

  const windowStart = Math.max(0, idx - (PRESSURE_SUSTAIN_HOURS - 1));
  const lastN = records.slice(windowStart, idx + 1);

  // pressure_slope_6h is null for the first 5 rows of the dataset — a 6-hour
  // slope is undefined until 6 hours exist. Null is "not measured", which is
  // not the same as "stable", so the watcher reports that state explicitly
  // rather than coercing it to a number.
  const slope = current.pressure_slope_6h;
  const sustainedFiring =
    lastN.length === PRESSURE_SUSTAIN_HOURS &&
    lastN.every((r) => r.pressure_slope_6h !== null && r.pressure_slope_6h < PRESSURE_FIRING_THRESHOLD);

  let rawStatus: WatcherStatus;
  if (sustainedFiring) {
    rawStatus = "firing";
  } else if (slope !== null && slope < PRESSURE_WATCHING_THRESHOLD) {
    rawStatus = "watching";
  } else {
    rawStatus = "quiet";
  }

  const deciding = sustainedFiring ? lastN : [current];
  const evidence: WatcherEvidence[] = deciding
    .filter((r) => r.pressure_slope_6h !== null)
    .map((r) => ({
      hour: r.timestamp,
      signal: "pressure_slope_6h",
      value: r.pressure_slope_6h as number,
      threshold: PRESSURE_FIRING_THRESHOLD,
    }));

  let rawReasoning: string;
  if (rawStatus === "firing") {
    rawReasoning = `Pressure has fallen at ${Math.abs(slope as number).toFixed(
      1
    )} kPa/h for the last ${PRESSURE_SUSTAIN_HOURS} hours.`;
  } else if (rawStatus === "watching") {
    rawReasoning = `Pressure is declining (${(slope as number).toFixed(
      1
    )} kPa/h) but hasn't sustained past -${Math.abs(PRESSURE_FIRING_THRESHOLD)} kPa/h for ${PRESSURE_SUSTAIN_HOURS} hours yet.`;
  } else if (slope === null) {
    rawReasoning =
      "Pressure slope is not yet defined — fewer than 6 hours of history at this point in the record.";
  } else {
    rawReasoning = `Pressure slope is stable at ${slope.toFixed(1)} kPa/h.`;
  }

  const { status, reasoning } = downgradeIfGapFilled(rawStatus, deciding, rawReasoning);

  return {
    entry: "Entry 1",
    status,
    subsystem: status === "quiet" ? null : "water",
    evidence,
    reasoning,
  };
}

// --- Entry 3: fans running in circles (SUPPORTED, strongest signal) ---

function checkEntry3(window: WindowData, timestamp: string): WatcherResult {
  const records = sortedRecords(window.records);
  const idx = indexOfTimestamp(records, timestamp);
  const current = records[idx];

  // Reported for context only — deliberately NOT used to set status; the
  // absolute -0.5 threshold is the validated rule. Measured against the
  // regression's clean residual SD, not baseline.residual.std (see the
  // RESIDUAL_HEALTHY_SD note above).
  const mean = DERIVED_CONSTANTS.ventilation_threshold.healthy_mean;
  const sigmaFromHealthy =
    RESIDUAL_HEALTHY_SD > 0 ? (current.residual - mean) / RESIDUAL_HEALTHY_SD : 0;

  let rawStatus: WatcherStatus;
  if (current.residual < RESIDUAL_FIRING_THRESHOLD) {
    rawStatus = "firing";
  } else if (current.residual < RESIDUAL_WATCHING_THRESHOLD) {
    rawStatus = "watching";
  } else {
    rawStatus = "quiet";
  }

  const evidence: WatcherEvidence[] = [
    {
      hour: current.timestamp,
      signal: "residual",
      value: current.residual,
      threshold: RESIDUAL_FIRING_THRESHOLD,
    },
  ];

  const rawReasoning =
    rawStatus === "firing"
      ? `Residual is ${current.residual.toFixed(3)}, well past the -0.5 ventilation threshold.`
      : rawStatus === "watching"
      ? `Residual is ${current.residual.toFixed(3)}, drifting toward the -0.5 ventilation threshold.`
      : `Residual is ${current.residual.toFixed(3)}, inside the healthy band (${Math.abs(
          sigmaFromHealthy
        ).toFixed(0)}σ from baseline mean — see the unresolved-baseline note).`;

  const { status, reasoning } = downgradeIfGapFilled(rawStatus, [current], rawReasoning);

  return {
    entry: "Entry 3",
    status,
    subsystem: status === "quiet" ? null : "ventilation",
    evidence,
    reasoning,
  };
}

// --- Entry 4: cold arrives later (REFUTED — watcher's job flips) ---
// Original claim (temperature lags the failure) didn't survive testing: lag
// is ~0. So this watcher checks, in real time, whether temperature_c moves
// in the SAME hour as a degradation event. "firing" here means "temperature
// just proved (again) it is not an early warning signal" — not danger.

function hasDegradation(r: SensorRecord): boolean {
  const slopeBad = r.pressure_slope_6h !== null && r.pressure_slope_6h < PRESSURE_FIRING_THRESHOLD;
  return slopeBad || r.residual < RESIDUAL_FIRING_THRESHOLD;
}

function checkEntry4(window: WindowData, timestamp: string): WatcherResult {
  const records = sortedRecords(window.records);
  const idx = indexOfTimestamp(records, timestamp);
  const current = records[idx];
  const previous = idx > 0 ? records[idx - 1] : null;

  const degrading = hasDegradation(current);
  const tempDelta = previous ? current.temperature_c - previous.temperature_c : null;

  let status: WatcherStatus;
  let reasoning: string;

  if (!degrading) {
    status = "quiet";
    reasoning =
      "No pressure or residual degradation this hour, so there's nothing to test temperature against.";
  } else if (tempDelta === null) {
    status = "watching";
    reasoning =
      "Degradation detected but there's no prior hour in this window to compare temperature against.";
  } else if (Math.abs(tempDelta) >= TEMP_MOVEMENT_EPSILON) {
    status = "firing";
    reasoning = `Temperature moved ${tempDelta.toFixed(
      3
    )}°C in the same hour as the degradation (lag ≈ 0) — this is NOT an early warning signal, it moves with the event.`;
  } else {
    status = "watching";
    reasoning = `Degradation is present but temperature has barely moved (${tempDelta.toFixed(
      3
    )}°C) this hour — inconclusive, watch next hour.`;
  }

  // Emit no evidence rather than a fabricated 0 when there's no prior hour to
  // diff against — 0 would read as "temperature didn't move", which is a
  // different claim from "we couldn't measure whether it moved".
  const evidence: WatcherEvidence[] =
    tempDelta === null
      ? []
      : [
          {
            hour: current.timestamp,
            signal: "temperature_c_delta",
            value: tempDelta,
            threshold: TEMP_MOVEMENT_EPSILON,
          },
        ];

  return {
    entry: "Entry 4",
    status,
    subsystem: null,
    evidence,
    reasoning,
  };
}

// --- Entry 5: missing pieces, repurposed as data-integrity watcher ---
// The literal "gaps are informative" claim didn't survive testing (see
// Person A's missingness analysis). This watcher instead checks whether
// gap-filled/uncalibrated data could be quietly distorting the other four.

function longestConsecutiveGapRun(records: SensorRecord[]): number {
  let longest = 0;
  let current = 0;
  for (const r of records) {
    if (r.is_gap_filled) {
      current += 1;
      longest = Math.max(longest, current);
    } else {
      current = 0;
    }
  }
  return longest;
}

function checkEntry5(window: WindowData, timestamp: string): WatcherResult {
  const records = recordsUpTo(sortedRecords(window.records), timestamp);
  const barrySource = records.filter((r) => r.sensor_source === "barry_j_");
  const suspectCalibration = barrySource.some((r) => r.airflow_corrected === r.airflow_m3s);
  const longestGapRun = longestConsecutiveGapRun(records);
  const clustering = longestGapRun >= GAP_CLUSTER_THRESHOLD;
  const anyGaps = records.some((r) => r.is_gap_filled);

  let status: WatcherStatus;
  if (suspectCalibration || clustering) {
    status = "firing";
  } else if (anyGaps || barrySource.length > 0) {
    status = "watching";
  } else {
    status = "quiet";
  }

  const evidence: WatcherEvidence[] = [
    {
      hour: records[records.length - 1]?.timestamp ?? "",
      signal: "longest_gap_run_hours",
      value: longestGapRun,
      threshold: GAP_CLUSTER_THRESHOLD,
    },
  ];

  let reasoning: string;
  if (suspectCalibration) {
    reasoning =
      "barry_j_ source records show airflow_corrected == airflow_m3s — the calibration correction doesn't look applied upstream.";
  } else if (clustering) {
    reasoning = `${longestGapRun} consecutive gap-filled hours — gaps are clustering, worth a second look.`;
  } else if (anyGaps) {
    reasoning = "Some gap-filled records in this window, but nothing clustering or uncalibrated.";
  } else {
    reasoning = "All records in this window are original-source, no gaps. Calibration looks clean.";
  }

  return {
    entry: "Entry 5",
    status,
    subsystem: null,
    evidence,
    reasoning,
  };
}

// --- Entry 2: the library has a rhythm (EXCLUDED FROM SEVERITY) ---
// sound_event maps ~1:1 onto system_status, so using it as a detector is
// leakage (reading the ground-truth label). Exposed separately so Person C's
// aggregator never scores it as a severity signal.
//
// Rather than hardcode an external sound->status mapping we don't have real
// numbers for, this fits the modal (most common) status per sound_event
// within the window itself, then measures agreement against that fit. If the
// mapping really is 1:1, every sound_event value co-occurs with exactly one
// system_status value and accuracy is 1.0 — the same property Person A's
// full-dataset confusion matrix found.

function computeListenerValidation(window: WindowData, timestamp: string): ListenerValidation {
  const records = recordsUpTo(sortedRecords(window.records), timestamp);
  const statusCountsBySound = new Map<string, Map<string, number>>();

  for (const r of records) {
    if (!statusCountsBySound.has(r.sound_event)) {
      statusCountsBySound.set(r.sound_event, new Map());
    }
    const counts = statusCountsBySound.get(r.sound_event)!;
    counts.set(r.system_status, (counts.get(r.system_status) ?? 0) + 1);
  }

  const modalStatusForSound = new Map<string, string>();
  for (const [sound, counts] of statusCountsBySound) {
    let bestStatus = "";
    let bestCount = -1;
    for (const [status, count] of counts) {
      if (count > bestCount) {
        bestStatus = status;
        bestCount = count;
      }
    }
    modalStatusForSound.set(sound, bestStatus);
  }

  const correct = records.filter((r) => modalStatusForSound.get(r.sound_event) === r.system_status)
    .length;
  const accuracy = records.length > 0 ? correct / records.length : 1;

  // Honesty guard. The mapping above is fitted on the very records it then
  // scores, so on a short window it is close to guaranteed to return 1.0
  // whatever the data does — that is a property of the arithmetic, not a
  // finding. Person A's full-dataset confusion matrix is the real result;
  // until it lands, say so in the payload rather than letting a hollow 1.0
  // travel into the UI looking like evidence.
  const selfFitted = records.length < 24 || modalStatusForSound.size < 2;

  return {
    entry: "Entry 2",
    accuracy_vs_system_status: Number(accuracy.toFixed(4)),
    note: selfFitted
      ? `Window-local figure only (n=${records.length}, ${modalStatusForSound.size} distinct sound_event value(s)) — the mapping is fitted on the same rows it scores, so this number is not yet independent evidence. Use Person A's full-dataset confusion matrix.`
      : "The young dragons' ears are exactly as accurate as the sensors — never earlier, never later.",
  };
}

/**
 * Runs every watcher against an already-loaded window. Exported so the tests
 * can drive hand-built fixtures without touching the real dataset.
 */
export function checkWindow(window: WindowData, timestamp: string): WatcherReport {
  return {
    watchers: [
      checkEntry1(window, timestamp),
      checkEntry3(window, timestamp),
      checkEntry4(window, timestamp),
      checkEntry5(window, timestamp),
    ],
    listener_validation: computeListenerValidation(window, timestamp),
  };
}

/** Production entry point — loads the real window, then runs every watcher. */
export function checkAllWatchers(timestamp: string): WatcherReport {
  return checkWindow(getWindow(timestamp), timestamp);
}

// Exported for targeted testing / reuse by the aggregator if it wants
// per-entry results without recomputing the whole report.
export { checkEntry1, checkEntry3, checkEntry4, checkEntry5, computeListenerValidation };
