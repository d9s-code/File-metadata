export type Role = "admin" | "editor" | "viewer";

export type EmitterStatus = "draft" | "in_review" | "validated" | "deprecated";

export type MdfStatus = "draft" | "pending_review" | "approved" | "released" | "deprecated";

export type TestType = "simulation" | "lab_bench" | "live_range" | "field_exercise";
export type TestResult = "pass" | "fail" | "partial" | "inconclusive";

export type PriType = "fixed" | "stagger" | "cw" | "xlet";

export type ElementType = "rf" | "pw" | "pri" | "scan";
export type ElementVariant = "typical" | "discrete" | "most_probable" | "extreme";
export type SourceStatus = "approved" | "pending_review" | "rejected";

export interface User {
  id: string;
  username: string;
  role: Role;
  is_active: boolean;
  created_at: string;
  last_login_at: string | null;
}

export interface EmitterSummary {
  rf_min_mhz: number | null;
  rf_max_mhz: number | null;
  pw_min_us: number | null;
  pw_max_us: number | null;
  pri_min_us: number | null;
  pri_max_us: number | null;
  scan_min: number | null;
  scan_max: number | null;
  mode_count: number;
  modes_passing: number;
}

export interface Emitter {
  id: string;
  name: string;
  designation: string | null;
  description: string | null;
  status: EmitterStatus;
  /** Set from the required note when moving Operational -> Needs rework;
   * cleared on any transition away from Needs rework. */
  rework_note: string | null;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
  summary: EmitterSummary;
}

export interface EwGroup {
  id: string;
  emitter_id: string;
  name: string;
  scan_min: number | null;
  scan_max: number | null;
  scan_delta: number | null;
  engineered_scan_min: number | null;
  engineered_scan_max: number | null;
  threat_priority: number | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface Source {
  id: string;
  emitter_id: string;
  name: string;
  description: string | null;
  source_date: string;
  status: SourceStatus;
  import_batch_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ModeLineFields {
  rf_min_mhz: number;
  rf_max_mhz: number;
  pw_min_us: number;
  pw_max_us: number;
  rf_delta?: number | null;
  pw_delta?: number | null;
  pri_delta?: number | null;
  pri_min_us?: number | null;
  pri_max_us?: number | null;
  jitter_min_us?: number | null;
  jitter_max_us?: number | null;
  pri_stagger_values_us?: number[] | null;
  type_data?: Record<string, unknown> | null;
}

export interface ModeLine extends ModeLineFields {
  id: string;
  mode_id: string;
  dsl_text: string | null;
  created_at: string;
  engineered_rf_min_mhz: number | null;
  engineered_rf_max_mhz: number | null;
  engineered_pw_min_us: number | null;
  engineered_pw_max_us: number | null;
  engineered_pri_min_us: number | null;
  engineered_pri_max_us: number | null;
}

export type ModeStatus = "approved" | "draft" | "superseded" | "rejected";

export interface TestRecordBrief {
  id: string;
  title: string;
  test_type: TestType;
  result: TestResult;
  test_date: string;
}

export interface Mode {
  id: string;
  ew_group_id: string;
  source_id: string;
  name: string;
  pri_type: PriType;
  notes: string | null;
  sort_order: number;
  generation_batch_id: string | null;
  status: ModeStatus;
  /** Set only on a `draft` Mode: the `approved` Mode it would replace. */
  supersedes_id: string | null;
  created_at: string;
  updated_at: string;
  line: ModeLine | null;
  /** Computed on read from test history — see backend mode_test_status_service. */
  last_tested_at: string | null;
  last_test_result: TestResult | null;
  last_test_record_id: string | null;
  /** Test Record(s) whose findings explain this Mode's values (empty for a
   * Mode that came from a Source instead). Computed on read; only populated
   * on list endpoints — see backend mode_test_status_service. */
  derived_from_test_records: TestRecordBrief[];
}

export interface ModeGenerationBatch {
  id: string;
  ew_group_id: string;
  source_id: string;
  name_prefix: string;
  created_at: string;
  mode_count: number;
}

export interface ModeElement {
  id: string;
  source_id: string;
  element_type: ElementType;
  variant: ElementVariant | null;
  value_min: number | null;
  value_max: number | null;
  stagger_values: number[] | null;
  jitter_min: number | null;
  jitter_max: number | null;
  delta: number | null;
  engineered_min: number | null;
  engineered_max: number | null;
  label: string | null;
  sort_order: number;
}

export interface ParameterSequenceStep {
  order: number;
  rf_mhz?: number | null;
  pw_us?: number | null;
  pri_us?: number | null;
  scan_value?: number | null;
  dwell_s?: number | null;
}

export interface ParameterSequence {
  id: string;
  source_id: string;
  label: string | null;
  variant: ElementVariant | null;
  steps: ParameterSequenceStep[];
  sort_order: number;
  created_at: string;
}

export type AuditAction =
  | "create"
  | "update"
  | "delete"
  | "status_change"
  | "commit"
  | "login"
  | "login_failed"
  | "logout";

export interface AuditLogEntry {
  id: string;
  actor_id: string | null;
  actor_username: string | null;
  action: AuditAction;
  entity_type: string;
  entity_id: string | null;
  summary: string;
  changes: Record<string, unknown> | null;
  created_at: string;
}

export interface AuditGroupCount {
  entity_type: string;
  count: number;
}

export interface AuditActionCount {
  action: AuditAction;
  count: number;
}

export interface AuditEntitySearchResult {
  entity_type: string;
  entity_id: string;
  name: string;
}

export interface ApiError {
  detail: string | { msg: string }[];
}
