import { api } from "./client";

export interface Platform {
  id: string;
  name: string;
  description: string | null;
  is_deleted: boolean;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PlatformLink {
  id: string;
  platform_id: string;
  emitter_id: string;
  emitter_version_id: string;
  added_at: string;
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
