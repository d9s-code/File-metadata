import { api } from "./client";
import type { MdfNote } from "../types/domain";

export const mdfNotesApi = {
  list: (mdfId: string) => api.get<MdfNote[]>(`/mdfs/${mdfId}/notes`),
  create: (mdfId: string, body: string) => api.post<MdfNote>(`/mdfs/${mdfId}/notes`, { body }),
  delete: (mdfId: string, noteId: string) => api.delete<void>(`/mdfs/${mdfId}/notes/${noteId}`),
};
