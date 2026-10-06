import { api } from "./client";

export type AmbiguityScopeType = "emitter" | "platform" | "mdf";
export type AmbiguityRunStatus = "pending" | "complete" | "failed";
export type AmbiguitySeverity = "none" | "low" | "medium" | "high" | "exact_overlap";

export interface ToleranceConfig {
  low_threshold: number;
  high_threshold: number;
  exact_threshold: number;
  /** Compare each range widened by its ± margin. Absent on checks made before
   * margins were used — those compared the ranges as typed. */
  apply_margins?: boolean;
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
  ai_summary: AiRunSummary | null;
}

/** Who asked the language model, which model answered, and how long it took. */
export interface AiStamp {
  model: string;
  generated_at: string;
  generated_by: string | null;
  seconds: number;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  /** Numbers in the answer that weren't in what the model was given. */
  unverified_numbers: string[];
}

export type AiRecommendation =
  | "keep_both"
  | "tighten_ranges"
  | "merge_modes"
  | "add_distinguishing_parameter"
  | "check_source_data";

export interface AiFindingExplanation extends AiStamp {
  explanation: string;
  distinguishing: string;
  recommendation: AiRecommendation;
  recommendation_label: string;
  recommendation_detail: string;
  confidence: "low" | "medium" | "high";
}

export interface AiRunSummary extends AiStamp {
  overview: string;
  priorities: string[];
  patterns: string[];
  findings_given: number;
  findings_total: number;
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

export type OverlapParam = "rf" | "pw" | "pri";

/** One side's ranges as the check compared them. */
export interface ComparedSide {
  rf: [number, number];
  pw: [number, number];
  pri: [number, number] | null;
  stagger: number[] | null;
}

export interface FindingModeSide {
  mode_name: string;
  pri_type?: string;
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
  details: {
    mode_a: FindingModeSide;
    mode_b: FindingModeSide;
    /** On checks made since margins were used: */
    margins_applied?: boolean;
    limiting?: OverlapParam;
    compared?: { mode_a: ComparedSide; mode_b: ComparedSide };
  };
  reviewed_by: string | null;
  reviewed_at: string | null;
  reviewer_note: string | null;
  ai_explanation: AiFindingExplanation | null;
  resolution: FindingResolution | null;
}

/** What was done about a finding from this page. */
export interface FindingResolution {
  action: "merged";
  kept_mode_id: string;
  kept_name: string;
  removed_mode_id: string;
  removed_name: string;
  by: string;
  at: string;
}

export interface MergeSpans {
  rf: [number, number];
  pw: [number, number];
  pri?: [number, number];
  stagger?: number[];
}

export interface MergePlan {
  keep: "a" | "b";
  kept: { id: string; name: string; before: MergeSpans; after: MergeSpans };
  removed: { id: string; name: string; source_name: string; spans: MergeSpans };
  links_moved: { intercept_entries: number; test_records: number; test_record_lines: number; test_lines: number };
  new_overlaps: { mode_id: string; mode_name: string; before: AmbiguitySeverity | "none"; after: AmbiguitySeverity }[];
  emitter: { id: string; name: string; checked_out_by_id: string | null };
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
  explainFinding: (findingId: string, refresh = false) =>
    api.post<AmbiguityFinding>(`/ambiguity/findings/${findingId}/explain${refresh ? "?refresh=true" : ""}`),
  summariseRun: (runId: string, refresh = false) =>
    api.post<AmbiguityRun>(`/ambiguity/runs/${runId}/summary${refresh ? "?refresh=true" : ""}`),
  mergePreview: (findingId: string, keep: "a" | "b") =>
    api.post<MergePlan>(`/ambiguity/findings/${findingId}/merge-preview`, { keep }),
  merge: (findingId: string, keep: "a" | "b") =>
    api.post<AmbiguityFinding>(`/ambiguity/findings/${findingId}/merge`, { keep }),
  aiStatus: () => api.get<{ enabled: boolean; model: string | null }>("/ai/status"),
};
