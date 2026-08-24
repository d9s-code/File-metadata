import { api } from "./client";

export type AmbiguityScopeType = "emitter" | "platform" | "mdf";
export type AmbiguityRunStatus = "pending" | "complete" | "failed";
export type AmbiguitySeverity = "none" | "low" | "medium" | "high" | "exact_overlap";

export interface ToleranceConfig {
  low_threshold: number;
  high_threshold: number;
  exact_threshold: number;
}

export interface AmbiguityRun {
  id: string;
  scope_type: AmbiguityScopeType;
  scope_id: string;
  emitter_version_id: string | null;
  platform_version_id: string | null;
  mdf_version_id: string | null;
  status: AmbiguityRunStatus;
  tolerance_config: ToleranceConfig;
  error_message: string | null;
  created_by: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface ModeLineSnapshot {
  rf_min_mhz: number;
  rf_max_mhz: number;
  pw_min_us: number;
  pw_max_us: number;
  pri_min_us: number | null;
  pri_max_us: number | null;
  jitter_min_us: number | null;
  jitter_max_us: number | null;
  pri_stagger_values_us: number[] | null;
}

export interface FindingModeSide {
  mode_name: string;
  ew_group_id: string;
  ew_group_name: string;
  source_id: string;
  source_name: string;
  emitter_id: string;
  emitter_name: string;
  platform_id: string | null;
  platform_name: string | null;
  line: ModeLineSnapshot;
}

export interface AmbiguityFinding {
  id: string;
  run_id: string;
  mode_id_a: string;
  mode_id_b: string;
  rf_overlap_pct: number;
  pw_overlap_pct: number;
  pri_overlap_pct: number | null;
  pri_comparison_type: string;
  combined_severity: AmbiguitySeverity;
  details: { mode_a: FindingModeSide; mode_b: FindingModeSide };
  reviewed_by: string | null;
  reviewed_at: string | null;
  reviewer_note: string | null;
}

export interface AmbiguityRunCreateInput {
  scope_type: AmbiguityScopeType;
  scope_id: string;
  version_number?: number;
  tolerance_config?: ToleranceConfig;
}

export const ambiguityApi = {
  createRun: (input: AmbiguityRunCreateInput) => api.post<AmbiguityRun>("/ambiguity/runs", input),
  getRun: (runId: string) => api.get<AmbiguityRun>(`/ambiguity/runs/${runId}`),
  listRuns: (scopeType: AmbiguityScopeType, scopeId: string) =>
    api.get<AmbiguityRun[]>(`/ambiguity/runs?scope_type=${scopeType}&scope_id=${scopeId}`),
  listFindings: (runId: string) => api.get<AmbiguityFinding[]>(`/ambiguity/runs/${runId}/findings`),
  reviewFinding: (findingId: string, reviewerNote?: string) =>
    api.post<AmbiguityFinding>(`/ambiguity/findings/${findingId}/review`, { reviewer_note: reviewerNote }),
  unreviewFinding: (findingId: string) => api.post<AmbiguityFinding>(`/ambiguity/findings/${findingId}/unreview`),
};
