// Shared types for the watcher pipeline and the reconciliation agent.
// The window/record shape is owned by Person A's export (getWindow); this is
// the contract we've agreed on until their code lands.

// Sensor-data shapes are owned by Person A's lib/data.ts — re-exported here so
// there is exactly one definition. `export type` (not `export`) matters: it is
// erased at compile time, so importing these never pulls data.ts's `fs`
// dependency into a client bundle.
//
// The old duplicate declared `pressure_slope_6h: number` and gave Baseline an
// `[key: string]` index signature; both conflicted with the real loader.
export type { SensorRecord, BaselineStat, Baseline, Episode, DerivedConstants } from "./data";

import type { SensorRecord, Baseline } from "./data";

export interface WindowData {
  records: SensorRecord[];
  baseline: Baseline;
}

export type WatcherStatus = "quiet" | "watching" | "firing";
export type Subsystem = "water" | "ventilation" | null;

export interface WatcherEvidence {
  hour: string;
  signal: string;
  value: number;
  threshold: number;
}

export interface WatcherResult {
  entry: string;
  status: WatcherStatus;
  subsystem: Subsystem;
  evidence: WatcherEvidence[];
  reasoning: string;
}

export interface ListenerValidation {
  entry: "Entry 2";
  accuracy_vs_system_status: number;
  note: string;
}

export interface WatcherReport {
  watchers: WatcherResult[];
  listener_validation: ListenerValidation;
}

// --- Reconciliation Agent ---

export type Verdict = "supported" | "refuted" | "untestable" | "disputed";

export interface LedgerRow {
  id: string;
  source_label: string;
  claim: string;
  verdict: Verdict;
  evidence: string;
  conflicts_with: string | null;
  data_leans_toward: string | null;
  operational_rule: string | null;
  note_to_dragons: string;
  timestamp_added: string;
}

export interface ReconcileRequest {
  source_label: string;
  text: string;
}


/* ===========================================================================
 * Person C — severity, diagnosis and the /api/diagnose contract.
 *
 * The watcher shapes above are Person B's and are reused verbatim; the
 * aliases below exist so Person C's modules keep their own vocabulary
 * without a second, drifting definition of the same object.
 * ======================================================================== */

export type Severity = "red" | "amber" | "green";
export type Mode = "plumbing" | "ventilation" | "stable";

/** Person C's name for WatcherResult. */
export type WatcherOutput = WatcherResult;
/** Person C's name for WatcherEvidence. */
export type Evidence = WatcherEvidence;
/** Person C's name for WatcherReport. */
export type WatcherBundle = WatcherReport;

export type LedgerStatus = "confirmed" | "disputed" | "unverified";

/**
 * A ledger row as READ by the diagnosis pipeline. Deliberately loose: rows are
 * passed through to the UI verbatim, and Person B's LedgerRow (id/source_label/
 * verdict/conflicts_with) is one valid shape among others.
 */
export interface LedgerEntry {
  id?: string;
  entry?: string;
  subsystem?: Subsystem;
  claim?: string;
  status?: LedgerStatus | string;
  source?: string;
  updated_at?: string;
  [key: string]: unknown;
}

export interface Diagnosis {
  entry_cited: string;
  subsystem_scope: "water" | "ventilation";
  mode: Mode;
  headline: string;
  recommended_action: string;
  reasoning: string;
  predicted_to_escalate: boolean;
  escalation_basis: string | null;
  hours_to_critical_estimate: number | null;
  /** Only present when predicted_to_escalate is true. */
  speech_text?: string;
  confidence: "low" | "moderate" | "high";
  caveat: string;
}

/** LOCKED RESPONSE SHAPE — the UI builds against this. */
export interface DiagnoseResponse {
  severity: Severity;
  watchers: WatcherOutput[];
  listener_validation: ListenerValidation;
  diagnosis: Diagnosis | null;
  ledger_snapshot: LedgerEntry[];
  tokens_used: number;
  estimated_cost_usd: number;
  /** Additive and optional. */
  served_from_cache?: boolean;
  warnings?: string[];
}
