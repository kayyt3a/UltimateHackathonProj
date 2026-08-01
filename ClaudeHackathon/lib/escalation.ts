import type { LedgerEntry, Mode, Subsystem, WatcherOutput } from "./types";
import { firingWatchers } from "./aggregate";
import { EPISODES, onsetPhrase, waterEscalationPhrase } from "./analysis";
import { canonicalEntry } from "./contract";

/**
 * The deterministic honesty rules. These are computed in code and then used
 * twice: once to tell the Voice agent what it is allowed to claim, and once
 * afterwards to overrule it if it claims something else anyway.
 *
 * Person A's analysis: 0/24 green->amber onset transitions were caught, so a
 * brand-new fault starting is NOT predictable. Only amber->red escalation of an
 * already-firing warning is, and only for the water pressure-slope signature.
 */

/** Entry 1 scopes the recommendation to plumbing/water. Entry 4 is REFUTED and
 * must never scope a recommendation — it was hijacking ventilation faults. */
const WATER_ENTRIES = new Set(["Entry 1"]);
/** Entry 3 firing scopes the recommendation to ventilation. */
const VENTILATION_ENTRIES = new Set(["Entry 3"]);

/**
 * Historical record, re-exported from Person A's analysis. Only four episodes
 * exist — say so, every time. Edit `lib/analysis.ts`, not this.
 */
export const HISTORY = {
  waterFaultsThatReachedFailure: EPISODES.water.reachedFailure,
  waterFaultsTotal: EPISODES.water.total,
  ventilationFaultsThatSelfResolved: EPISODES.ventilation.selfResolved,
  ventilationFaultsTotal: EPISODES.ventilation.total,
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
      reason: `Entry 1 is not firing. A brand-new fault starting (green->amber onset) is not predictable — ${onsetPhrase()} historically.`,
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
    // Same optional chaining as hasPressureSlopeRule: an evidence row with no
    // signal name sits earlier in the array often enough that a bare
    // .toLowerCase() here would throw on input the check above accepted.
    e.signal?.toLowerCase().includes("pressure_slope"),
  );
  // Only quote a rate we actually have. A missing or zeroed value would
  // otherwise be spoken as "falling at 0 kPa/h", which is a number we invented.
  const rate =
    slope && Number.isFinite(slope.value) && slope.value !== 0
      ? `${Math.abs(slope.value)} kPa/h`
      : "the observed rate";

  return {
    allowed: true,
    reason:
      "Entry 1 is firing on water with the pressure-slope rule active — the one signature with historical escalation evidence.",
    permittedBasis:
      `pressure has been falling at ${rate}; this pattern preceded total failure in ` +
      waterEscalationPhrase(),
    sourceEntry: "Entry 1",
  };
}

export interface ScopeRuling {
  subsystem_scope: "water" | "ventilation";
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
 * Which note a ledger row is about.
 *
 * Person C's own fixture uses `entry: "Entry 1"`. Person B's reconciliation
 * agent emits `id: "entry_1"` and `source_label: "Cloudy's notes — Entry 1"`
 * with no `entry` field at all — so matching on `entry` alone would find zero
 * relevant rows against their ledger and silently stop reporting disputes.
 */
export function ledgerEntryLabel(row: LedgerEntry): string | null {
  for (const candidate of [row.entry, row.id, row.source_label]) {
    const label = canonicalEntry(candidate);
    if (label) return label;
  }
  return null;
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
    // A null/!object row is Person B's data, not ours — one malformed entry
    // must not throw and take the whole Voice call down with it.
    if (!row || typeof row !== "object") return false;
    const label = ledgerEntryLabel(row);
    if (label && activeEntries.has(label)) return true;
    if (row.subsystem && activeSubsystems.has(row.subsystem)) return true;
    return false;
  });
}

/**
 * Whether a ledger row represents contested knowledge.
 *
 * Deliberately tolerant about Person B's field naming and vocabulary: a
 * disagreement that is silently missed because the field was called `state`
 * instead of `status` would let the Voice agent claim certainty it has not
 * earned. Erring toward "this is disputed" is the safe direction.
 */
const DISPUTE_FIELDS = ["status", "state", "verification", "verdict", "confidence"];
const DISPUTE_WORDS = /(disput|disagree|contest|conflict|contradict|unresolved|refuted)/;
/**
 * "undisputed" / "indisputable" mean the opposite. The prefix only negates when
 * stripping it leaves a dispute word — "unresolved" is itself a dispute marker,
 * not a negation of "resolved".
 */
const NEGATED_STATUS = /^((un|in|ir|im|non)[-_]?(disput|contest|conflict|contradict)|not[\s_-])/;

export function isDisputed(row: LedgerEntry): boolean {
  if (!row || typeof row !== "object") return false;

  for (const field of DISPUTE_FIELDS) {
    const value = row[field];
    if (typeof value !== "string") continue;
    const normalised = value.trim().toLowerCase();
    // Substring rather than exact match, so "in dispute" and "disputed by log"
    // are caught — a missed disagreement lets the Voice agent claim certainty.
    if (DISPUTE_WORDS.test(normalised) && !NEGATED_STATUS.test(normalised)) {
      return true;
    }
  }

  // Person B's reconciliation agent points at the row it conflicts with rather
  // than setting a status. A non-null pointer IS the disagreement.
  if (typeof row.conflicts_with === "string" && row.conflicts_with.trim()) {
    return true;
  }

  // Some ledgers carry an explicit flag instead of a status string. Accept the
  // truthy spellings a JSON producer plausibly emits, not just a real boolean.
  const flag = row.disputed;
  if (flag === true || flag === 1) return true;
  if (typeof flag === "string") {
    return ["true", "yes", "y", "1"].includes(flag.trim().toLowerCase());
  }
  return false;
}

export function disputedLedgerEntries(
  watchers: WatcherOutput[],
  ledger: LedgerEntry[],
): LedgerEntry[] {
  return relevantLedgerEntries(watchers, ledger).filter(isDisputed);
}
