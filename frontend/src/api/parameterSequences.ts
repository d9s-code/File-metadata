import { api } from "./client";
import type { ParameterSequence } from "../types/domain";

export const parameterSequencesApi = {
  list: (emitterId: string, sourceId: string) =>
    api.get<ParameterSequence[]>(`/emitters/${emitterId}/sources/${sourceId}/parameter-sequences`),
};
