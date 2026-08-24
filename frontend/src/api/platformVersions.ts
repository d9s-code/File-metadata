import { api } from "./client";
import type { DiffResult, VersionSummary } from "../types/versioning";

export type PlatformVersionSummary = VersionSummary & { platform_id: string };

export const platformVersionsApi = {
  list: (platformId: string) => api.get<PlatformVersionSummary[]>(`/platforms/${platformId}/versions`),
  commit: (platformId: string, changeSummary?: string) =>
    api.post<PlatformVersionSummary>(`/platforms/${platformId}/versions`, { change_summary: changeSummary }),
  diff: (platformId: string, versionNumber: number, against?: number) =>
    api.get<DiffResult>(
      `/platforms/${platformId}/versions/${versionNumber}/diff${against != null ? `?against=${against}` : ""}`
    ),
};
