import type { LedgerEntry, Mode, Subsystem, WatcherOutput } from "./types";
import { firingWatchers } from "./aggregate";

/**
 * The deterministic honesty rules. These are computed in code and then used
 * twice: once to tell the Voice agent what it is allowed to claim, and once
 * afterwards to overrule it if it claims something else anyway.
 *
 * Person A's analysis: 0/24 green->amber onset transitions were caught, so a
 * brand-new fault starting is NOT predictable. Only amber->red escalation of an
 * already-firing warning is, and only for the water pressure-slope signature.
 */

/** Entry 1 or Entry 4 firing scopes the recommendation to plumbing/water. */
const WATER_ENTRIES = new Set(["Entry 1", "Entry 4"]);
/** Entry 3 firing scopes the recommendation to ventilation. */
const VENTILATION_ENTRIES = new Set(["Entry 3"]);

/** Historical record. Only four episodes exist — say so, every time. */
export const HISTORY = {
  waterFaultsThatReachedFailure: 2,
  waterFaultsTotal: 2,
  ventilationFaultsThatSelfResolved: 2,
  ventilationFaultsTotal: 2,
} as const;

export interface EscalationRuling {
  /** May the Voice agent set predicted_to_escalate: true at all? */
  allowed: boolean;
  /** Human-readable reason, used in the prompt and in guardrail warnings. */
  reason: string;
  /** The only escalation_basis wording the historical record supports. */
  permittedBasis: string | null;
  /** The watcher that licenses the escalation claim, if any. */
  sourceEntry: string | null;
}

function hasPressureSlopeRule(watcher: WatcherOutput): boolean {
  return watcher.evidence.some((e) =>
    e.signal?.toLowerCase().includes("pressure_slope"),
  );
}

/**
 * Escalation may only be predicted when Entry 1 is firing on the water
 * subsystem with the pressure-slope rule active. Everything else — including a
 * firing ventilation watcher — is not predictable from four episodes.
 */
export function rulePredictedEscalation(
  watchers: WatcherOutput[],
): EscalationRuling {
  const entry1 = watchers.find(
    (w) => w.entry === "Entry 1" && w.status === "firing",
  );

  if (!entry1) {
    return {
      allowed: false,
      reason:
        "Entry 1 is not firing. A brand-new fault starting (green->amber onset) is not predictable — 0 of 24 onset transitions were caught historically.",
      permittedBasis: null,
      sourceEntry: null,
    };
  }

  if (entry1.subsystem !== "water") {
    return {
      allowed: false,
      reason: `Entry 1 is firing but on subsystem "${entry1.subsystem}", not water. Only the water signature has historical escalation evidence.`,
      permittedBasis: null,
      sourceEntry: null,
    };
  }

  if (!hasPressureSlopeRule(entry1)) {
    return {
      allowed: false,
      reason:
        "Entry 1 is firing on water but the pressure-slope rule is not among its evidence. No other water signal has escalation evidence.",
      permittedBasis: null,
      sourceEntry: null,
    };
  }

  const slope = entry1.evidence.find((e) =>
    e.signal.toLowerCase().includes("pressure_slope"),
  );
  const rate = slope ? `${Math.abs(slope.value)} kPa/h` : "the observed rate";

  return {
    allowed: true,
    reason:
      "Entry 1 is firing on water with the pressure-slope rule active — the one signature with historical escalation evidence.",
    permittedBasis:
      `pressure has been falling at ${rate}; this pattern preceded total failure in ` +
      `${HISTORY.waterFaultsThatReachedFailure} of ${HISTORY.waterFaultsTotal} past water faults`,
    sourceEntry: "Entry 1",
  };
}

export interface ScopeRuling {
  subsystem_scope: Subsystem;
  mode: Mode;
  entry_cited: string;
  reason: string;
}

/**
 * Scope the recommendation to the sick subsystem only — never a blanket
 * shutdown. This resolves the shelter's "two leaders" conflict for free.
 *
 * Firing watchers win over watching ones; water wins over ventilation when both
 * are active, because water is the subsystem that can escalate.
 */
export function ruleScope(watchers: WatcherOutput[]): ScopeRuling {
  const firing = firingWatchers(watchers);
  const watching = watchers.filter((w) => w.status === "watching");

  for (const [pool, label] of [
    [firing, "firing"],
    [watching, "watching"],
  ] as const) {
    const water = pool.find((w) => WATER_ENTRIES.has(w.entry));
    if (water) {
      return {
        subsystem_scope: "water",
        mode: "plumbing",
        entry_cited: water.entry,
        reason: `${water.entry} is ${label}; scope is the water subsystem only.`,
      };
    }

    const vent = pool.find((w) => VENTILATION_ENTRIES.has(w.entry));
    if (vent) {
      return {
        subsystem_scope: "ventilation",
        mode: "ventilation",
        entry_cited: vent.entry,
        reason: `${vent.entry} is ${label}; scope is the ventilation subsystem only.`,
      };
    }
  }

  const anyActive = firing[0] ?? watching[0];
  return {
    subsystem_scope: anyActive?.subsystem ?? "water",
    mode: "stable",
    entry_cited: anyActive?.entry ?? "Entry 5",
    reason:
      "No entry maps to a known subsystem; recommendation is not scoped to a shutdown.",
  };
}

/**
 * Ledger rows relevant to the currently-active watchers. If any of these is
 * `disputed`, the Voice agent must name the disagreement rather than pretend
 * certainty.
 */
export function relevantLedgerEntries(
  watchers: WatcherOutput[],
  ledger: LedgerEntry[],
): LedgerEntry[] {
  const activeEntries = new Set(
    watchers.filter((w) => w.status !== "quiet").map((w) => w.entry),
  );
  const activeSubsystems = new Set(
    watchers
      .filter((w) => w.status !== "quiet" && w.subsystem)
      .map((w) => w.subsystem as Subsystem),
  );

  return ledger.filter((row) => {
    if (row.entry && activeEntries.has(row.entry)) return true;
    if (row.subsystem && activeSubsystems.has(row.subsystem)) return true;
    return false;
  });
}

export function disputedLedgerEntries(
  watchers: WatcherOutput[],
  ledger: LedgerEntry[],
): LedgerEntry[] {
  return relevantLedgerEntries(watchers, ledger).filter(
    (row) => String(row.status).toLowerCase() === "disputed",
  );
}
