import { useQuery } from "@tanstack/react-query";
import { parameterSequencesApi } from "../../api/parameterSequences";

export function parameterSequencesKey(emitterId: string, sourceId: string) {
  return ["parameterSequences", emitterId, sourceId] as const;
}

export function useParameterSequences(emitterId: string, sourceId: string) {
  return useQuery({
    queryKey: parameterSequencesKey(emitterId, sourceId),
    queryFn: () => parameterSequencesApi.list(emitterId, sourceId),
    enabled: !!sourceId,
  });
}
