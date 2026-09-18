import { api } from "./client";
import type { InterceptNote } from "../types/domain";

export const interceptNotesApi = {
  list: (interceptId: string) => api.get<InterceptNote[]>(`/intercepts/${interceptId}/notes`),
  create: (interceptId: string, body: string) =>
    api.post<InterceptNote>(`/intercepts/${interceptId}/notes`, { body }),
  delete: (interceptId: string, noteId: string) =>
    api.delete<void>(`/intercepts/${interceptId}/notes/${noteId}`),
};
