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
