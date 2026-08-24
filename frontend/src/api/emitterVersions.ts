import { api } from "./client";
import type { DiffResult, VersionSummary } from "../types/versioning";

export type EmitterVersionSummary = VersionSummary & { emitter_id: string };

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
