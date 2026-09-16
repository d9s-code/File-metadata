import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
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

export function useDeleteParameterSequence(emitterId: string, sourceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (sequenceId: string) =>
      parameterSequencesApi.delete(emitterId, sourceId, sequenceId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: parameterSequencesKey(emitterId, sourceId) });
    },
  });
}

export function useDeleteParameterSequenceStep(
  emitterId: string,
  sourceId: string
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ sequenceId, stepOrder }: { sequenceId: string; stepOrder: number }) =>
      parameterSequencesApi.deleteStep(emitterId, sourceId, sequenceId, stepOrder),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: parameterSequencesKey(emitterId, sourceId) });
    },
  });
}

export function useCreateParameterSequence(emitterId: string, sourceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: any) =>
      parameterSequencesApi.create(emitterId, sourceId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: parameterSequencesKey(emitterId, sourceId) });
    },
  });
}

export function useUpdateParameterSequence(emitterId: string, sourceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      sequenceId,
      input,
    }: {
      sequenceId: string;
      input: { rf_delta?: number | null; pw_delta?: number | null; pri_delta?: number | null };
    }) => parameterSequencesApi.update(emitterId, sourceId, sequenceId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: parameterSequencesKey(emitterId, sourceId) });
    },
  });
}
