import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { sourcesApi, type SourceInput } from "../../api/sources";

export function sourcesKey(emitterId: string) {
  return ["sources", emitterId] as const;
}

export function useSources(emitterId: string) {
  return useQuery({ queryKey: sourcesKey(emitterId), queryFn: () => sourcesApi.list(emitterId) });
}

export function useCreateSource(emitterId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SourceInput) => sourcesApi.create(emitterId, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: sourcesKey(emitterId) }),
  });
}

export function useDeleteSource(emitterId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sourceId: string) => sourcesApi.delete(emitterId, sourceId),
    onSuccess: () => qc.invalidateQueries({ queryKey: sourcesKey(emitterId) }),
  });
}
