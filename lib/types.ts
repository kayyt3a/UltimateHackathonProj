/**
 * Shared contract types for "Cloudy's Second Opinion".
 *
 * Person B owns the watcher shapes (input); Person C owns severity, diagnosis
 * and the /api/diagnose response (output); Person D builds against
 * `DiagnoseResponse`.
 */

export type WatcherStatus = "firing" | "watching" | "quiet";
export type Severity = "red" | "amber" | "green";
export type Subsystem = "water" | "ventilation";
export type Mode = "plumbing" | "ventilation" | "stable";

export interface Evidence {
  hour: string;
  signal: string;
  value: number;
  threshold: number;
}

export interface WatcherOutput {
  /** "Entry 1" | "Entry 3" | "Entry 4" | "Entry 5" */
  entry: string;
  status: WatcherStatus;
  subsystem: Subsystem | null;
  evidence: Evidence[];
  reasoning: string;
}

/**
 * Entry 2 measures how well the young dragons' hearing tracks system_status.
 * It is informational only and NEVER enters the severity calculation.
 */
export interface ListenerValidation {
  entry: string;
  accuracy_vs_system_status: number;
  note: string;
}

export interface WatcherBundle {
  watchers: WatcherOutput[];
  listener_validation: ListenerValidation;
}

export type LedgerStatus = "confirmed" | "disputed" | "unverified";

/**
 * A row of Person B's knowledge ledger. Unknown extra fields are preserved
 * verbatim so the ledger panel can render whatever Person B ends up emitting.
 */
export interface LedgerEntry {
  id?: string;
  entry?: string;
  subsystem?: Subsystem | null;
  claim?: string;
  status?: LedgerStatus | string;
  source?: string;
  updated_at?: string;
  [key: string]: unknown;
}

export interface Diagnosis {
  entry_cited: string;
  subsystem_scope: Subsystem;
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

/** LOCKED RESPONSE SHAPE — Person D builds against this. */
export interface DiagnoseResponse {
  severity: Severity;
  watchers: WatcherOutput[];
  listener_validation: ListenerValidation;
  diagnosis: Diagnosis | null;
  ledger_snapshot: LedgerEntry[];
  tokens_used: number;
  estimated_cost_usd: number;

  /**
   * Additive, optional fields. Person D can ignore these entirely; they exist
   * for the demo's own honesty panel and for cache fallback signalling.
   */
  served_from_cache?: boolean;
  /** Deterministic guardrails that had to overrule the model this tick. */
  warnings?: string[];
}
