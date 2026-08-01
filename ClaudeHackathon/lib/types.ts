// Shared types for the watcher pipeline and the reconciliation agent.
// The window/record shape is owned by Person A's export (getWindow); this is
// the contract we've agreed on until their code lands.

export interface SensorRecord {
  timestamp: string;
  power_kw: number;
  airflow_m3s: number;
  airflow_corrected: number;
  water_pressure_kpa: number;
  water_flow_lps: number;
  temperature_c: number;
  vibration_level: number;
  sound_event: string;
  system_status: string;
  sensor_source: string;
  is_gap_filled: boolean;
  residual: number;
  pressure_slope_6h: number;
}

export interface BaselineStat {
  mean: number;
  std: number;
}

export interface Baseline {
  residual: BaselineStat;
  water_pressure_kpa: BaselineStat;
  vibration_level: BaselineStat;
  [key: string]: BaselineStat;
}

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
