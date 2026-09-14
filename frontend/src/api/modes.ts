import { api } from "./client";
import type { Mode, ModeLineFields, PriType } from "../types/domain";

export interface ModeCreateInput {
  source_id: string;
  name: string;
  pri_type: PriType;
  notes?: string | null;
  sort_order?: number;
  line: ModeLineFields;
  derived_from_test_record_ids?: string[];
}

export interface ModeUpdateInput {
  name?: string;
  notes?: string | null;
  sort_order?: number;
  ew_group_id?: string;
  line?: ModeLineFields;
}

export interface ModeDraftInput {
  name?: string;
  ew_group_id?: string;
  source_id?: string;
  notes?: string | null;
  pri_type: PriType;
  line: ModeLineFields;
  derived_from_test_record_ids?: string[];
}

export interface ModeBatchUpdateInput {
  mode_ids: string[];
  name?: string;
  notes?: string | null;
  sort_order?: number;
  ew_group_id?: string;
  source_id?: string;
}

export const modesApi = {
  list: (ewGroupId: string, includeHistory = false) =>
    api.get<Mode[]>(`/ew-groups/${ewGroupId}/modes${includeHistory ? "?include_history=true" : ""}`),
  listByEmitter: (emitterId: string, includeHistory = false) =>
    api.get<Mode[]>(`/emitters/${emitterId}/modes${includeHistory ? "?include_history=true" : ""}`),
  create: (ewGroupId: string, input: ModeCreateInput) =>
    api.post<Mode>(`/ew-groups/${ewGroupId}/modes`, input),
  update: (ewGroupId: string, modeId: string, input: ModeUpdateInput) =>
    api.patch<Mode>(`/ew-groups/${ewGroupId}/modes/${modeId}`, input),
  delete: (ewGroupId: string, modeId: string) => api.delete<void>(`/ew-groups/${ewGroupId}/modes/${modeId}`),
  proposeDraft: (ewGroupId: string, modeId: string, input: ModeDraftInput) =>
    api.post<Mode>(`/ew-groups/${ewGroupId}/modes/${modeId}/draft`, input),
  approve: (ewGroupId: string, modeId: string) =>
    api.post<Mode>(`/ew-groups/${ewGroupId}/modes/${modeId}/approve`, {}),
  reject: (ewGroupId: string, modeId: string) =>
    api.post<Mode>(`/ew-groups/${ewGroupId}/modes/${modeId}/reject`, {}),
  batchUpdate: (ewGroupId: string, input: ModeBatchUpdateInput) =>
    api.patch< { updated_count: number }>(`/ew-groups/${ewGroupId}/modes/batch`, input),
};
