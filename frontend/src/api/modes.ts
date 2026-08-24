import { api } from "./client";
import type { Mode, ModeLineFields, PriType } from "../types/domain";

export interface ModeCreateInput {
  source_id: string;
  name: string;
  pri_type: PriType;
  notes?: string | null;
  sort_order?: number;
  line: ModeLineFields;
}

export interface ModeUpdateInput {
  name?: string;
  notes?: string | null;
  sort_order?: number;
  ew_group_id?: string;
  line?: ModeLineFields;
}

export const modesApi = {
  list: (ewGroupId: string) => api.get<Mode[]>(`/ew-groups/${ewGroupId}/modes`),
  listByEmitter: (emitterId: string) => api.get<Mode[]>(`/emitters/${emitterId}/modes`),
  create: (ewGroupId: string, input: ModeCreateInput) =>
    api.post<Mode>(`/ew-groups/${ewGroupId}/modes`, input),
  update: (ewGroupId: string, modeId: string, input: ModeUpdateInput) =>
    api.patch<Mode>(`/ew-groups/${ewGroupId}/modes/${modeId}`, input),
  delete: (ewGroupId: string, modeId: string) => api.delete<void>(`/ew-groups/${ewGroupId}/modes/${modeId}`),
};
