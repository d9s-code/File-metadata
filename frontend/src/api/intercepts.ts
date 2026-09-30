import { api } from "./client";
import type { Intercept, InterceptEntry, InterceptEntryFields, PriType } from "../types/domain";

export interface InterceptInput {
  emitter_id: string;
  name: string;
  description?: string | null;
  intercepted_on?: string | null;
  collected_by?: string | null;
}

export interface InterceptUpdateInput {
  name?: string;
  description?: string | null;
  intercepted_on?: string | null;
  collected_by?: string | null;
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
  /** Every entry of every Intercept on one Emitter. */
  listEmitterEntries: (emitterId: string) =>
    api.get<InterceptEntry[]>(`/intercepts/entries?emitter_id=${encodeURIComponent(emitterId)}`),
  /** Replaces an entry in place (same id, so a Mode created from it stays linked). */
  replaceEntry: (interceptId: string, entryId: string, input: InterceptEntryInput) =>
    api.put<InterceptEntry>(`/intercepts/${interceptId}/entries/${entryId}`, input),
  createEntry: (interceptId: string, input: InterceptEntryInput) =>
    api.post<InterceptEntry>(`/intercepts/${interceptId}/entries`, input),
  deleteEntry: (interceptId: string, entryId: string) =>
    api.delete<void>(`/intercepts/${interceptId}/entries/${entryId}`),
};
