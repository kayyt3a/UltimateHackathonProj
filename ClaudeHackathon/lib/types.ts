// Shared types for the watcher pipeline and the reconciliation agent.
// The window/record shape is owned by Person A's export (getWindow); this is
// the contract we've agreed on until their code lands.

// Matches prepared_data.json exactly (Person A's prepare_data.py output).
export interface SensorRecord {
  timestamp: string;
  power_kw: number;
  airflow_m3s: number;
  airflow_corrected: number;
  water_pressure_kpa: number;
  water_pressure_corrected: number;
  water_flow_lps: number;
  water_flow_corrected: number;
  temperature_c: number;
  vibration_level: number;
  sound_event: "normal" | "hum" | "rattle";
  system_status: "stable" | "warning" | "critical" | "failed";
  sensor_source: "original" | "barry_j_";
  is_gap_filled: boolean;
  residual: number;
  /**
   * NULL for the first 5 rows — a 6-hour slope is undefined until 6 hours of
   * history exist. Every consumer must handle null; treating it as 0 would
   * invent a "stable pressure" reading that was never measured.
   */
  pressure_slope_6h: number | null;
  novelty_score: number;
  is_novel: boolean;
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
