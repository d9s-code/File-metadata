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
};
