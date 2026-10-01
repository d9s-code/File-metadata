import { api } from "./client";
import type { SourceGroup } from "../types/domain";

/** One Source with its group, Emitter and dates — a row of the overview. */
export interface SourceOverview {
  id: string;
  name: string;
  status: string;
  source_type: string | null;
  /** "Date last updated" of the Source's contents (YYYY-MM-DD). */
  source_date: string;
  /** When the record was last edited here. */
  updated_at: string;
  group_id: string | null;
  group_name: string | null;
  emitter_id: string;
  emitter_name: string;
  emitter_designation: string | null;
  element_count: number;
  sequence_count: number;
  mode_count: number;
}

export const sourceGroupsApi = {
  list: () => api.get<SourceGroup[]>("/source-groups/"),
  /** Every Source on a live Emitter, grouped or not. */
  sourcesOverview: () => api.get<SourceOverview[]>("/source-groups/sources"),
  create: (input: { name: string; description?: string }) =>
    api.post<SourceGroup>("/source-groups/", input),
  update: (id: string, input: Partial<{ name: string; description: string }>) =>
    api.patch<SourceGroup>(`/source-groups/${id}`, input),
  delete: (id: string) => api.delete<void>(`/source-groups/${id}`),
};
