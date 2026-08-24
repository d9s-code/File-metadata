import { api } from "./client";

export interface EmitterVersionSummary {
  id: string;
  emitter_id: string;
  version_number: number;
  change_summary: string | null;
  created_by: string | null;
  created_at: string;
}

export interface DiffEntry {
  path: string;
  value?: unknown;
  old_value?: unknown;
  new_value?: unknown;
}

export interface DiffResult {
  added: DiffEntry[];
  removed: DiffEntry[];
  changed: DiffEntry[];
  identical: boolean;
}

export const emitterVersionsApi = {
  list: (emitterId: string) => api.get<EmitterVersionSummary[]>(`/emitters/${emitterId}/versions`),
  commit: (emitterId: string, changeSummary?: string) =>
    api.post<EmitterVersionSummary>(`/emitters/${emitterId}/versions`, { change_summary: changeSummary }),
  diff: (emitterId: string, versionNumber: number, against?: number) =>
    api.get<DiffResult>(
      `/emitters/${emitterId}/versions/${versionNumber}/diff${against != null ? `?against=${against}` : ""}`
    ),
  transitionStatus: (emitterId: string, newStatus: string, note?: string) =>
    api.post<EmitterVersionSummary>(`/emitters/${emitterId}/status`, { new_status: newStatus, note }),
};
