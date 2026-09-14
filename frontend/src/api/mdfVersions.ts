import { api } from "./client";
import type { DiffResult, VersionSummary } from "../types/versioning";

export type MdfVersionSummary = VersionSummary & { mdf_id: string };

export const mdfVersionsApi = {
  list: (mdfId: string) => api.get<MdfVersionSummary[]>(`/mdfs/${mdfId}/versions`),
  commit: (mdfId: string, changeSummary?: string) =>
    api.post<MdfVersionSummary>(`/mdfs/${mdfId}/versions`, { change_summary: changeSummary }),
  diff: (mdfId: string, versionNumber: number, against?: number) =>
    api.get<DiffResult>(
      `/mdfs/${mdfId}/versions/${versionNumber}/diff${against != null ? `?against=${against}` : ""}`
    ),
};
