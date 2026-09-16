import { api } from "./client";
import type { ParameterSequence } from "../types/domain";

export const parameterSequencesApi = {
  list: (emitterId: string, sourceId: string) =>
    api.get<ParameterSequence[]>(`/emitters/${emitterId}/sources/${sourceId}/parameter-sequences`),

  delete: (
    emitterId: string,
    sourceId: string,
    sequenceId: string
  ) =>
    api.delete<void>(
      `/emitters/${emitterId}/sources/${sourceId}/parameter-sequences/${sequenceId}`
    ),

  deleteStep: (
    emitterId: string,
    sourceId: string,
    sequenceId: string,
    stepOrder: number
  ) =>
    api.delete<void>(
      `/emitters/${emitterId}/sources/${sourceId}/parameter-sequences/${sequenceId}/steps/${stepOrder}`
    ),

  create: (emitterId: string, sourceId: string, input: any) =>
    api.post<ParameterSequence>(`/emitters/${emitterId}/sources/${sourceId}/parameter-sequences`, input),

  update: (
    emitterId: string,
    sourceId: string,
    sequenceId: string,
    input: { rf_delta?: number | null; pw_delta?: number | null; pri_delta?: number | null },
  ) =>
    api.patch<ParameterSequence>(
      `/emitters/${emitterId}/sources/${sourceId}/parameter-sequences/${sequenceId}`,
      input,
    ),
};
