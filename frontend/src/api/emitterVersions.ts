import { api } from "./client";
import type { Emitter } from "../types/domain";
import type { EmitterDiffResult, VersionSummary } from "../types/versioning";

export type EmitterVersionSummary = VersionSummary & { emitter_id: string };

/** A version ("3") or a checkpoint ("3.1") — a save made while editing,
 * between versions, never pinned, exported or tested against. */
export interface EmitterSave {
  kind: "version" | "checkpoint";
  ref: string;
  change_summary: string | null;
  created_at: string;
  created_by_username: string | null;
  /** A checkpoint made into a version: its number. */
  promoted_to_version_number: number | null;
  /** A version made from a checkpoint: that checkpoint's ref. */
  from_checkpoint: string | null;
}

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
  transitionStatus: (emitterId: string, newStatus: string, note?: string, confirmUnmet = false) =>
    api.post<Emitter>(`/emitters/${emitterId}/status`, {
      new_status: newStatus,
      note,
      confirm_unmet: confirmUnmet,
    }),
  /** What reverting would do, before it's done. */
  revertPreview: (emitterId: string, versionNumber: number) =>
    api.get<EmitterDiffResult & { results_naming_removed: number; unsaved_changes: number }>(
      `/emitters/${emitterId}/versions/${versionNumber}/revert-preview`,
    ),
  revert: (emitterId: string, versionNumber: number) =>
    api.post<EmitterVersionSummary>(`/emitters/${emitterId}/versions/${versionNumber}/revert`),
  /** Every version and checkpoint, oldest first. */
  history: (emitterId: string) => api.get<EmitterSave[]>(`/emitters/${emitterId}/history`),
  /** From one save (or "live") to another. */
  historyDiff: (emitterId: string, from: string, to = "live") =>
    api.get<EmitterDiffResult>(
      `/emitters/${emitterId}/history/diff?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    ),
  saveCheckpoint: (emitterId: string, changeSummary?: string) =>
    api.post<EmitterSave>(`/emitters/${emitterId}/checkpoints`, { change_summary: changeSummary || null }),
  restoreCheckpoint: (emitterId: string, ref: string) =>
    api.post<Emitter>(`/emitters/${emitterId}/checkpoints/${ref}/restore`),
  promoteCheckpoint: (emitterId: string, ref: string, changeSummary: string) =>
    api.post<EmitterSave>(`/emitters/${emitterId}/checkpoints/${ref}/promote`, { change_summary: changeSummary }),
  /** A new Emitter copied from this one as it stands now (unsaved changes included). */
  duplicate: (emitterId: string, newName: string) =>
    api.post<Emitter>(`/emitters/${emitterId}/duplicate`, { new_name: newName }),
  fork: (emitterId: string, versionNumber: number, newName: string) =>
    api.post<Emitter>(`/emitters/${emitterId}/versions/${versionNumber}/fork`, { new_name: newName }),
};
