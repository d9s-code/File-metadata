import { api } from "./client";
import type { Emitter } from "../types/domain";
import type { EmitterDiffResult, VersionSummary } from "../types/versioning";

export type EmitterVersionSummary = VersionSummary & { emitter_id: string };

export const emitterVersionsApi = {
  list: (emitterId: string) => api.get<EmitterVersionSummary[]>(`/emitters/${emitterId}/versions`),
  // change_summary is required for an Emitter commit (unlike Platform/MDF).
  commit: (emitterId: string, changeSummary: string) =>
    api.post<EmitterVersionSummary>(`/emitters/${emitterId}/versions`, { change_summary: changeSummary }),
  diff: (emitterId: string, versionNumber: number, against?: number) =>
    api.get<EmitterDiffResult>(
      `/emitters/${emitterId}/versions/${versionNumber}/diff${against != null ? `?against=${against}` : ""}`
    ),
  liveDiff: (emitterId: string) => api.get<EmitterDiffResult>(`/emitters/${emitterId}/diff/live`),
  transitionStatus: (emitterId: string, newStatus: string, note?: string) =>
    api.post<EmitterVersionSummary>(`/emitters/${emitterId}/status`, { new_status: newStatus, note }),
  revert: (emitterId: string, versionNumber: number) =>
    api.post<EmitterVersionSummary>(`/emitters/${emitterId}/versions/${versionNumber}/revert`),
  fork: (emitterId: string, versionNumber: number, newName: string) =>
    api.post<Emitter>(`/emitters/${emitterId}/versions/${versionNumber}/fork`, { new_name: newName }),
};
