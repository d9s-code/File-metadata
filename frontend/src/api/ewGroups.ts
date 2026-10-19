import { api } from "./client";
import type { EwGroup } from "../types/domain";

export interface EwGroupInput {
  name: string;
  scan_min?: number | null;
  scan_max?: number | null;
  scan_delta?: number | null;
  threat_priority?: number | null;
  ageout?: number | null;
  sort_order?: number;
}

/** A first EW Group's scan range, from the Sources' scan Elements: the
 * shortest and longest scan time (s) among them. */
export interface EwGroupSuggestion {
  scan_min: number;
  scan_max: number;
  element_count: number;
  source_names: string[];
}

export const ewGroupsApi = {
  list: (emitterId: string) => api.get<EwGroup[]>(`/emitters/${emitterId}/ew-groups`),
  suggestion: (emitterId: string) =>
    api.get<EwGroupSuggestion | null>(`/emitters/${emitterId}/ew-groups/suggestion`),
  create: (emitterId: string, input: EwGroupInput) =>
    api.post<EwGroup>(`/emitters/${emitterId}/ew-groups`, input),
  update: (emitterId: string, ewGroupId: string, input: Partial<EwGroupInput>) =>
    api.patch<EwGroup>(`/emitters/${emitterId}/ew-groups/${ewGroupId}`, input),
  delete: (emitterId: string, ewGroupId: string) =>
    api.delete<void>(`/emitters/${emitterId}/ew-groups/${ewGroupId}`),
};
