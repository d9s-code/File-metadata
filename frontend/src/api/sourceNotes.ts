import { api } from "./client";
import type { SourceNote } from "../types/domain";

export const sourceNotesApi = {
  list: (emitterId: string, sourceId: string) =>
    api.get<SourceNote[]>(`/emitters/${emitterId}/sources/${sourceId}/notes`),
  create: (emitterId: string, sourceId: string, body: string) =>
    api.post<SourceNote>(`/emitters/${emitterId}/sources/${sourceId}/notes`, { body }),
  delete: (emitterId: string, sourceId: string, noteId: string) =>
    api.delete<void>(`/emitters/${emitterId}/sources/${sourceId}/notes/${noteId}`),
};
