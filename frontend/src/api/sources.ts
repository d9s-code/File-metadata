import { api } from "./client";
import type { Source } from "../types/domain";

export interface SourceInput {
  name: string;
  description?: string | null;
  source_date: string;
}

export const sourcesApi = {
  list: (emitterId: string) => api.get<Source[]>(`/emitters/${emitterId}/sources`),
  create: (emitterId: string, input: SourceInput) =>
    api.post<Source>(`/emitters/${emitterId}/sources`, input),
  update: (emitterId: string, sourceId: string, input: Partial<SourceInput>) =>
    api.patch<Source>(`/emitters/${emitterId}/sources/${sourceId}`, input),
  delete: (emitterId: string, sourceId: string) =>
    api.delete<void>(`/emitters/${emitterId}/sources/${sourceId}`),
};
