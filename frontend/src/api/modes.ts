import { api } from "./client";
import type { Mode, ModeLineFields, PriType } from "../types/domain";

export interface ModeCreateInput {
  source_id: string;
  name: string;
  pri_type: PriType;
  notes?: string | null;
  sort_order?: number;
  line: ModeLineFields;
  function_group_id?: string | null;
  derived_from_test_record_ids?: string[];
  derived_from_intercept_entry_ids?: string[];
}

export interface ModeUpdateInput {
  name?: string;
  notes?: string | null;
  sort_order?: number;
  ew_group_id?: string;
  function_group_id?: string | null;
  line?: ModeLineFields;
  derived_from_test_record_ids?: string[];
  derived_from_intercept_entry_ids?: string[];
}

export interface BatchModeFieldEdit {
  ew_group_id?: string;
  function_group_id?: string | null;
  notes?: string;
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

export const modesApi = {
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
