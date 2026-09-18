import { api } from "./client";
import type { Intercept, InterceptEntry, InterceptEntryFields, PriType } from "../types/domain";

export interface InterceptInput {
  emitter_id: string;
  name: string;
  description?: string | null;
}

export interface InterceptUpdateInput {
  name?: string;
  description?: string | null;
}

export interface InterceptEntryInput extends InterceptEntryFields {
  pri_type: PriType;
}

export const interceptsApi = {
  list: (params?: { emitterId?: string; search?: string }) => {
    const query = new URLSearchParams();
    if (params?.emitterId) query.set("emitter_id", params.emitterId);
    if (params?.search) query.set("search", params.search);
    const qs = query.toString();
    return api.get<Intercept[]>(`/intercepts${qs ? `?${qs}` : ""}`);
  },
  get: (interceptId: string) => api.get<Intercept>(`/intercepts/${interceptId}`),
  create: (input: InterceptInput) => api.post<Intercept>("/intercepts", input),
  update: (interceptId: string, input: InterceptUpdateInput) =>
    api.patch<Intercept>(`/intercepts/${interceptId}`, input),
  delete: (interceptId: string) => api.delete<void>(`/intercepts/${interceptId}`),
  listEntries: (interceptId: string) => api.get<InterceptEntry[]>(`/intercepts/${interceptId}/entries`),
  createEntry: (interceptId: string, input: InterceptEntryInput) =>
    api.post<InterceptEntry>(`/intercepts/${interceptId}/entries`, input),
  deleteEntry: (interceptId: string, entryId: string) =>
    api.delete<void>(`/intercepts/${interceptId}/entries/${entryId}`),
};
