import { api } from "./client";
import type { Allegiance } from "./platforms";

export interface ThreatPriorityRow {
  ew_group_id: string;
  ew_group_name: string;
  threat_priority: number | null;
  ageout: number | null;
  modes_count: number;
  emitter_id: string;
  emitter_name: string;
  designation: string | null;
  emitter_status: string;
  /** What kind of emitter (an Admin-kept function code); null on older Emitters. */
  function_code_id: string | null;
  checked_out_by_id: string | null;
  checked_out_by_username: string | null;
  platforms: { id: string; name: string; allegiance: Allegiance | null }[];
}

export interface ThreatPriorityResult {
  updated: number;
  unchanged: number;
  /** Emitters checked out to you by the change. */
  started_editing: string[];
}

export const threatPrioritiesApi = {
  list: () => api.get<ThreatPriorityRow[]>("/threat-priorities"),
  /** All or none; checks out to you an Emitter nobody is editing. */
  change: (changes: { ew_group_id: string; threat_priority: number | null }[]) =>
    api.post<ThreatPriorityResult>("/threat-priorities", { changes, start_editing: true }),
};
