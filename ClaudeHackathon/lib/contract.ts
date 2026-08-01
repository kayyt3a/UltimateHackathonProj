import type {
  Evidence,
  ListenerValidation,
  Subsystem,
  WatcherBundle,
  WatcherOutput,
  WatcherStatus,
} from "./types";

/**
 * Boundary normaliser for Person B's `checkAllWatchers` output.
 *
 * The honesty rules match on exact values — `entry === "Entry 1"`,
 * `subsystem === "water"`, `status === "firing"`. If Person B emits `entry_1`,
 * `Water`, or `FIRING`, every match silently fails: escalation is never
 * permitted, scope quietly degrades, and nobody finds out until the demo. So we
 * normalise here and report anything we could not recognise, rather than
 * letting a naming mismatch look like a healthy shelter.
 *
 * Every coercion is deliberately in the safe direction — an unreadable status
 * becomes `watching` (amber), never `quiet` (green).
 */

export interface NormalisedBundle {
  bundle: WatcherBundle;
  /** Contract mismatches worth surfacing. Empty means a clean handshake. */
  problems: string[];
}

/** "entry_1", "ENTRY 1", "Entry 1 — Water pressure" -> "Entry 1" */
export function canonicalEntry(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const match = raw.match(/entry[\s_-]*(\d+)/i);
  return match ? `Entry ${Number(match[1])}` : null;
}

function canonicalStatus(raw: unknown): WatcherStatus | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim().toLowerCase();
  if (value === "firing" || value === "watching" || value === "quiet") return value;
  // Common synonyms teammates reach for.
  if (["alarm", "alarming", "triggered", "active", "critical"].includes(value)) return "firing";
  if (["warning", "warn", "elevated", "watch"].includes(value)) return "watching";
  if (["ok", "normal", "clear", "idle", "nominal"].includes(value)) return "quiet";
  return null;
}

function canonicalSubsystem(raw: unknown): Subsystem | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim().toLowerCase();
  if (value === "water" || value === "plumbing") return "water";
  if (value === "ventilation" || value === "vent" || value === "air") return "ventilation";
  return null;
}

/**
 * `Number(null)`, `Number("")` and `Number(false)` are all 0, so a missing
 * reading would coerce to a real-looking zero and be reported as clean. The
 * escalation basis quotes this number back to a dragon, so only an actual
 * number (or a numeric string) counts; everything else is NaN and reported.
 */
function numericOrNaN(raw: unknown): number {
  if (typeof raw === "number") return raw;
  if (typeof raw === "string" && raw.trim() !== "") return Number(raw);
  return NaN;
}

function normaliseEvidence(raw: unknown, label: string, problems: string[]): Evidence[] {
  if (raw == null) return [];
  if (!Array.isArray(raw)) {
    problems.push(`${label}: evidence is not an array; treated as empty.`);
    return [];
  }

  const out: Evidence[] = [];
  for (const [i, item] of raw.entries()) {
    if (!item || typeof item !== "object") {
      problems.push(`${label}: evidence[${i}] is not an object; skipped.`);
      continue;
    }
    const e = item as Record<string, unknown>;
    const value = numericOrNaN(e.value);
    const threshold = numericOrNaN(e.threshold);
    if (typeof e.signal !== "string") {
      problems.push(`${label}: evidence[${i}] has no signal name; the escalation rule matches on signal names.`);
    }
    if (Number.isNaN(value) || Number.isNaN(threshold)) {
      problems.push(`${label}: evidence[${i}] has a non-numeric value/threshold.`);
    }
    out.push({
      hour: typeof e.hour === "string" ? e.hour : "",
      signal: typeof e.signal === "string" ? e.signal : "",
      value: Number.isNaN(value) ? 0 : value,
      threshold: Number.isNaN(threshold) ? 0 : threshold,
    });
  }
  return out;
}

const FALLBACK_VALIDATION: ListenerValidation = {
  entry: "Entry 2",
  accuracy_vs_system_status: 0,
  note: "No listener validation supplied by the watcher layer.",
};

export function normaliseWatcherBundle(raw: unknown): NormalisedBundle {
  const problems: string[] = [];

  if (!raw || typeof raw !== "object") {
    return {
      bundle: { watchers: [], listener_validation: FALLBACK_VALIDATION },
      problems: ["checkAllWatchers returned a non-object; no watchers available."],
    };
  }

  const input = raw as Record<string, unknown>;
  const rawWatchers = Array.isArray(input.watchers) ? input.watchers : [];
  if (!Array.isArray(input.watchers)) {
    problems.push("checkAllWatchers returned no `watchers` array.");
  }

  const watchers: WatcherOutput[] = [];
  for (const [i, item] of rawWatchers.entries()) {
    if (!item || typeof item !== "object") {
      problems.push(`watchers[${i}] is not an object; skipped.`);
      continue;
    }
    const w = item as Record<string, unknown>;
    const label = `watchers[${i}]`;

    const entry = canonicalEntry(w.entry);
    if (!entry) {
      problems.push(
        `${label}: unrecognised entry "${String(w.entry)}". Expected something matching "Entry <n>" — ` +
          `the escalation and scope rules key off Entry 1/3/4, so this watcher cannot license an escalation.`,
      );
    }

    const status = canonicalStatus(w.status);
    if (!status) {
      problems.push(
        `${label}: unrecognised status "${String(w.status)}"; treated as "watching" (amber) rather than quiet.`,
      );
    }

    const subsystem = canonicalSubsystem(w.subsystem);
    if (w.subsystem != null && !subsystem) {
      problems.push(`${label}: unrecognised subsystem "${String(w.subsystem)}"; treated as null.`);
    }

    watchers.push({
      entry: entry ?? String(w.entry ?? `watchers[${i}]`),
      status: status ?? "watching",
      subsystem,
      evidence: normaliseEvidence(w.evidence, label, problems),
      reasoning: typeof w.reasoning === "string" ? w.reasoning : "",
    });
  }

  const lv = input.listener_validation as Record<string, unknown> | undefined;
  let listener_validation: ListenerValidation;
  if (!lv || typeof lv !== "object") {
    problems.push("No listener_validation supplied; Entry 2's panel will show a placeholder.");
    listener_validation = FALLBACK_VALIDATION;
  } else {
    const accuracy = Number(lv.accuracy_vs_system_status);
    listener_validation = {
      entry: (canonicalEntry(lv.entry) ?? "Entry 2") as "Entry 2",
      accuracy_vs_system_status: Number.isNaN(accuracy) ? 0 : accuracy,
      note: typeof lv.note === "string" ? lv.note : "",
    };
  }

  const seen = new Set(watchers.map((w) => w.entry));
  for (const expected of ["Entry 1", "Entry 3", "Entry 4", "Entry 5"]) {
    if (!seen.has(expected)) {
      problems.push(`${expected} is missing from the watcher output.`);
    }
  }

  return { bundle: { watchers, listener_validation }, problems };
}
