import { api } from "./client";
import type { Emitter } from "../types/domain";

export interface EmitterCreateInput {
  name: string;
  designation?: string;
  description?: string;
}

export const emittersApi = {
  list: (includeDeleted = false) =>
    api.get<Emitter[]>(`/emitters${includeDeleted ? "?include_deleted=true" : ""}`),
  get: (id: string) => api.get<Emitter>(`/emitters/${id}`),
  create: (input: EmitterCreateInput) => api.post<Emitter>("/emitters", input),
  update: (id: string, input: Partial<EmitterCreateInput>) => api.patch<Emitter>(`/emitters/${id}`, input),
  delete: (id: string, hard = false) => api.delete<void>(`/emitters/${id}${hard ? "?hard=true" : ""}`),
  restore: (id: string) => api.post<Emitter>(`/emitters/${id}/restore`),
  exportPrs: (id: string, options?: any) => api.post<void>(`/emitters/${id}/export/prs`, undefined, options),
  exportXml: (id: string, options?: any) => api.post<Blob>(`/emitters/${id}/export/xml`, undefined, options),
  // sourceDate (YYYY-MM-DD), if given, overrides the "Date last updated" the
  // importer would otherwise parse from the JSON file's own per-set
  // date_last_updated field — see transformer.py.
  importJson: (emitterId: string, file: File, sourceDate?: string) => {
    const formData = new FormData();
    formData.append("file", file);
    if (sourceDate) formData.append("source_date", sourceDate);
    return api.post<void>(`/emitters/${emitterId}/imports/json-import`, formData);
  },
};
