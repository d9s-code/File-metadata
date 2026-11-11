import { api } from "./client";
import type { ParameterSequence, SequenceKind } from "../types/domain";

export interface ParameterSequenceUpdate {
  rf_delta?: number | null;
  pw_delta?: number | null;
  pri_delta?: number | null;
  /** null: back to guessed. */
  kind?: SequenceKind | null;
}

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
    input: ParameterSequenceUpdate,
  ) =>
    api.patch<ParameterSequence>(
      `/emitters/${emitterId}/sources/${sourceId}/parameter-sequences/${sequenceId}`,
      input,
    ),
};
