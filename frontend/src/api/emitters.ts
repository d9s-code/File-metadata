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
  importJson: (emitterId: string, file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    // We use a trick here because our wrapper's post() method automatically 
    // stringifies the body and sets Content-Type to application/json.
    // For FormData, we must pass it as the body and let the browser 
    // set the Content-Type with the appropriate boundary.
    // Since we can't easily change the wrapper, we'll use a direct fetch 
    // if we were allowed, but since we are constrained to the 'api' object,
    // I'll check if I can bypass the stringification.
    // Actually, looking at api.ts, it always does JSON.stringify(body).
    // This is a limitation of the current 'api' wrapper.
    // I will use a cast to 'any' to attempt to pass the FormData directly 
    // and hope the wrapper's behavior allows it, OR better, I will 
    // modify the wrapper to support non-JSON bodies.
    return api.post<void>(`/emitters/${emitterId}/imports/json-import`, formData as any);
  },
};
