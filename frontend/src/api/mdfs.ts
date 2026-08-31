import { api } from "./client";
import type { MdfStatus } from "../types/domain";

export interface Mdf {
  id: string;
  name: string;
  description: string | null;
  status: MdfStatus;
  is_deleted: boolean;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface MdfLink {
  id: string;
  mdf_id: string;
  platform_id: string;
  platform_version_id: string;
  added_at: string;
}

export interface MdfCreateInput {
  name: string;
  description?: string;
}

export const mdfsApi = {
  list: (includeDeleted = false) => api.get<Mdf[]>(`/mdfs${includeDeleted ? "?include_deleted=true" : ""}`),
  get: (id: string) => api.get<Mdf>(`/mdfs/${id}`),
  create: (input: MdfCreateInput) => api.post<Mdf>("/mdfs", input),
  update: (id: string, input: Partial<MdfCreateInput>) => api.patch<Mdf>(`/mdfs/${id}`, input),
  delete: (id: string, hard = false) => api.delete<void>(`/mdfs/${id}${hard ? "?hard=true" : ""}`),
  restore: (id: string) => api.post<Mdf>(`/mdfs/${id}/restore`),

  listLinks: (mdfId: string) => api.get<MdfLink[]>(`/mdfs/${mdfId}/links`),
  pinPlatform: (mdfId: string, platformId: string, platformVersionId: string) =>
    api.post<MdfLink>(`/mdfs/${mdfId}/links`, { platform_id: platformId, platform_version_id: platformVersionId }),
  unpinPlatform: (mdfId: string, platformId: string) => api.delete<void>(`/mdfs/${mdfId}/links/${platformId}`),

  getReadiness: (mdfId: string) => api.get<{ warnings: string[] }>(`/mdfs/${mdfId}/status/readiness`),
  transitionStatus: (mdfId: string, newStatus: string, note?: string) =>
    api.post<{ warnings: string[] }>(`/mdfs/${mdfId}/status`, { new_status: newStatus, note }),
};
