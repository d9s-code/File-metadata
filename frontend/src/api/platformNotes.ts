import { api } from "./client";
import type { PlatformNote } from "../types/domain";

export const platformNotesApi = {
  list: (platformId: string) => api.get<PlatformNote[]>(`/platforms/${platformId}/notes`),
  create: (platformId: string, body: string) => api.post<PlatformNote>(`/platforms/${platformId}/notes`, { body }),
  delete: (platformId: string, noteId: string) => api.delete<void>(`/platforms/${platformId}/notes/${noteId}`),
};
