import { api } from "./client";
import type { Source } from "../types/domain";

export interface SourceInput {
  name: string;
  description?: string | null;
  source_date: string;
  group_id?: string | null;
}

export const sourcesApi = {
  list: (emitterId: string) => api.get<Source[]>(`/emitters/${emitterId}/sources`),
  create: (emitterId: string, input: SourceInput) =>
    api.post<Source>(`/emitters/${emitterId}/sources`, input),
  update: (emitterId: string, sourceId: string, input: Partial<SourceInput>) =>
    api.patch<Source>(`/emitters/${emitterId}/sources/${sourceId}`, input),
  delete: (emitterId: string, sourceId: string) =>
    api.delete<void>(`/emitters/${emitterId}/sources/${sourceId}`),
  approve: (emitterId: string, sourceId: string) =>
    api.post<Source>(`/emitters/${emitterId}/sources/${sourceId}/approve`, {}),
  reject: (emitterId: string, sourceId: string) =>
    api.post<Source>(`/emitters/${emitterId}/sources/${sourceId}/reject`, {}),
  listParameterSequences: (emitterId: string, sourceId: string) =>
    api.get<any[]>(`/emitters/${emitterId}/sources/${sourceId}/parameter-sequences`),

  deleteParameterSequence: (
    emitterId: string,
    sourceId: string,
    sequenceId: string
  ) =>
    api.delete<void>(
      `/emitters/${emitterId}/sources/${sourceId}/parameter-sequences/${sequenceId}`
    ),

  deleteParameterSequenceStep: (
    emitterId: string,
    sourceId: string,
    sequenceId: string,
    stepOrder: number
  ) =>
    api.delete<void>(
      `/emitters/${emitterId}/sources/${sourceId}/parameter-sequences/${sequenceId}/steps/${stepOrder}`
    ),
};
