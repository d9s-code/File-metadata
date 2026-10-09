import { api } from "./client";
import type { EmitterStatus } from "../types/domain";

export interface Platform {
  id: string;
  name: string;
  description: string | null;
  is_deleted: boolean;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
  /** On the list only. */
  summary?: PlatformSummary;
}

/** What the Platforms list shows about one Platform. */
export interface PlatformSummary {
  emitter_count: number;
  /** Live statuses of the pinned Emitters, and the worst of them. */
  status_counts: Record<EmitterStatus, number>;
  worst_status: EmitterStatus | null;
  outdated_pins: number;
  /** Modes in the pinned Emitter versions. */
  mode_count: number;
  mdf_count: number;
  latest_version_number: number | null;
  latest_version_at: string | null;
  /** From the latest finished ambiguity check; null when never checked. */
  ambiguity_checked_at: string | null;
  ambiguous_emitters: number | null;
  open_ambiguities: number | null;
}

export interface PlatformLink {
  id: string;
  platform_id: string;
  emitter_id: string;
  emitter_version_id: string;
  added_at: string;
  /** The pinned version's number and the Emitter's latest saved one; the pin is outdated when latest > pinned. */
  pinned_version_number?: number | null;
  latest_version_number?: number | null;
  latest_version_id?: string | null;
}

/** True when the Emitter has a newer saved version than the one pinned. */
export function isOutdatedPin(link: PlatformLink): boolean {
  return (
    link.pinned_version_number != null &&
    link.latest_version_number != null &&
    link.latest_version_number > link.pinned_version_number
  );
}

export interface PlatformCreateInput {
  name: string;
  description?: string;
}

export const platformsApi = {
  list: (includeDeleted = false) =>
    api.get<Platform[]>(`/platforms${includeDeleted ? "?include_deleted=true" : ""}`),
  get: (id: string) => api.get<Platform>(`/platforms/${id}`),
  create: (input: PlatformCreateInput) => api.post<Platform>("/platforms", input),
  update: (id: string, input: Partial<PlatformCreateInput>) => api.patch<Platform>(`/platforms/${id}`, input),
  delete: (id: string, hard = false) => api.delete<void>(`/platforms/${id}${hard ? "?hard=true" : ""}`),
  restore: (id: string) => api.post<Platform>(`/platforms/${id}/restore`),

  listLinks: (platformId: string) => api.get<PlatformLink[]>(`/platforms/${platformId}/links`),
  pinEmitter: (platformId: string, emitterId: string, emitterVersionId: string) =>
    api.post<PlatformLink>(`/platforms/${platformId}/links`, {
      emitter_id: emitterId,
      emitter_version_id: emitterVersionId,
    }),
  unpinEmitter: (platformId: string, emitterId: string) =>
    api.delete<void>(`/platforms/${platformId}/links/${emitterId}`),
  exportXml: (platformId: string) =>
    api.post<Blob>(`/platforms/${platformId}/export/xml`, {}),
  exportPrs: (platformId: string, versionNumber: number) =>
    api.get<Blob>(`/platforms/${platformId}/versions/${versionNumber}/export/prs`),
};

/** One Mode's ranges as of a pinned Emitter version: raw and engineered (± delta). */
export interface CoverageMode {
  /** The Mode's id (missing only on very old snapshots). */
  id?: string | null;
  name: string;
  pri_type: string;
  rf: [number, number];
  rf_raw: [number, number];
  pri: [number, number] | null;
  pri_raw: [number, number] | null;
  pw: [number, number] | null;
  pw_raw: [number, number] | null;
}

/** What one pinned Emitter version covers. */
export interface EmitterCoverage {
  emitter_id: string;
  emitter_name: string;
  designation: string | null;
  version_number: number;
  modes: CoverageMode[];
}

export const platformCoverageApi = {
  get: (platformId: string) => api.get<EmitterCoverage[]>(`/platforms/${platformId}/coverage`),
};

/** A Platform version pinned on an MDF, with what its Emitters cover. */
export interface PlatformCoverage {
  platform_id: string;
  platform_name: string;
  version_number: number;
  emitters: EmitterCoverage[];
}

export const mdfCoverageApi = {
  get: (mdfId: string) => api.get<PlatformCoverage[]>(`/mdfs/${mdfId}/coverage`),
};
