import { api } from "./client";
import type { Mode, ModeLineFields, PriType } from "../types/domain";

export interface ModeCreateInput {
  /** Every Source the Mode comes from (one or more), or source_id for just one. */
  source_ids?: string[];
  source_id?: string;
  name: string;
  pri_type: PriType;
  notes?: string | null;
  sort_order?: number;
  confirmation_quality?: number;
  confirmation_quantity?: number;
  line: ModeLineFields;
  derived_from_test_record_ids?: string[];
  derived_from_intercept_entry_ids?: string[];
}

export interface ModeUpdateInput {
  name?: string;
  notes?: string | null;
  sort_order?: number;
  confirmation_quality?: number;
  confirmation_quantity?: number;
  ew_group_id?: string;
  /** Replaces the Mode's Sources (one or more). */
  source_ids?: string[];
  /** Changing this requires `line` in the same request — see the backend's
   * own note on why there's no partial edit across a PRI type change. */
  pri_type?: PriType;
  line?: ModeLineFields;
  derived_from_test_record_ids?: string[];
  derived_from_intercept_entry_ids?: string[];
}

export interface BatchModeFieldEdit {
  ew_group_id?: string;
  /** Makes this each selected Mode's only Source. */
  source_id?: string;
  /** Adds this Source to each selected Mode's Sources. */
  add_source_id?: string;
  notes?: string;
  confirmation_quality?: number;
  confirmation_quantity?: number;
  rf_range_matching?: boolean;
  pw_range_matching?: boolean;
  pri_range_matching?: boolean;
  rf_delta?: number;
  pw_delta?: number;
  pri_delta?: number;
  frame_time_delta_us?: number;
  rf_min_shift?: number;
  rf_max_shift?: number;
  pw_min_shift?: number;
  pw_max_shift?: number;
  pri_min_shift?: number;
  pri_max_shift?: number;
}

export interface ModeBatchEditInput {
  mode_ids: string[];
  fields: BatchModeFieldEdit;
  derived_from_test_record_ids?: string[];
  derived_from_intercept_entry_ids?: string[];
  shift_reason?: string;
}

export interface ModeBatchEditError {
  mode_id: string;
  mode_name: string;
  error: string;
}

export interface ModeBatchEditResult {
  updated_mode_ids: string[];
  count: number;
}

/** What the planning page applies in one go — see backend InterceptModePlan. */
export interface InterceptModePlanInput {
  intercept_id: string;
  source_id?: string | null;
  name_prefix?: string | null;
  confirmation_quality: number;
  confirmation_quantity: number;
  new_modes: { entry_ids: string[]; pri_type: PriType; line: ModeLineFields }[];
  widen: ({ mode_id: string; entry_ids: string[] } & {
    rf_min_mhz?: number;
    rf_max_mhz?: number;
    pri_min_us?: number;
    pri_max_us?: number;
    pw_min_us?: number;
    pw_max_us?: number;
    frame_time_delta_us?: number;
  })[];
}

export interface InterceptModePlanResult {
  created: Mode[];
  widened: Mode[];
}

export const modesApi = {
  applyInterceptPlan: (ewGroupId: string, input: InterceptModePlanInput) =>
    api.post<InterceptModePlanResult>(`/ew-groups/${ewGroupId}/modes/from-intercept-plan`, input),
  list: (ewGroupId: string) => api.get<Mode[]>(`/ew-groups/${ewGroupId}/modes`),
  listByEmitter: (emitterId: string) => api.get<Mode[]>(`/emitters/${emitterId}/modes`),
  create: (ewGroupId: string, input: ModeCreateInput) =>
    api.post<Mode>(`/ew-groups/${ewGroupId}/modes`, input),
  update: (ewGroupId: string, modeId: string, input: ModeUpdateInput) =>
    api.patch<Mode>(`/ew-groups/${ewGroupId}/modes/${modeId}`, input),
  delete: (ewGroupId: string, modeId: string) => api.delete<void>(`/ew-groups/${ewGroupId}/modes/${modeId}`),
  batchEdit: (emitterId: string, input: ModeBatchEditInput) =>
    api.post<ModeBatchEditResult>(`/emitters/${emitterId}/modes/batch-edit`, input),
};
