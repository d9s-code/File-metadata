import { api } from "./client";
import type { EmitterNote } from "../types/domain";

export const emitterNotesApi = {
  list: (emitterId: string) => api.get<EmitterNote[]>(`/emitters/${emitterId}/notes`),
  create: (emitterId: string, body: string) =>
    api.post<EmitterNote>(`/emitters/${emitterId}/notes`, { body }),
  delete: (emitterId: string, noteId: string) =>
    api.delete<void>(`/emitters/${emitterId}/notes/${noteId}`),
};
