import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { modesApi, type ModeCreateInput, type ModeDraftInput } from "../../api/modes";
import { dslApi, type ModeFromDslInput } from "../../api/dsl";

export function modesKey(ewGroupId: string, includeHistory = false) {
  return ["modes", ewGroupId, includeHistory] as const;
}

export function emitterModesKey(emitterId: string, includeHistory = false) {
  return ["modes", "emitter", emitterId, includeHistory] as const;
}

export function useModes(ewGroupId: string, includeHistory = false) {
  return useQuery({
    queryKey: modesKey(ewGroupId, includeHistory),
    queryFn: () => modesApi.list(ewGroupId, includeHistory),
  });
}

export function useEmitterModes(emitterId: string, includeHistory = false) {
  return useQuery({
    queryKey: emitterModesKey(emitterId, includeHistory),
    queryFn: () => modesApi.listByEmitter(emitterId, includeHistory),
  });
}

function invalidateModes(qc: ReturnType<typeof useQueryClient>, ewGroupId: string, emitterId: string) {
  qc.invalidateQueries({ queryKey: ["modes", ewGroupId] });
  qc.invalidateQueries({ queryKey: ["modes", "emitter", emitterId] });
}

export function useCreateMode(ewGroupId: string, emitterId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ModeCreateInput) => modesApi.create(ewGroupId, input),
    onSuccess: () => invalidateModes(qc, ewGroupId, emitterId),
  });
}

export function useCreateModeFromDsl(ewGroupId: string, emitterId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ModeFromDslInput) => dslApi.createModeFromDsl(ewGroupId, input),
    onSuccess: () => invalidateModes(qc, ewGroupId, emitterId),
  });
}

export function useDeleteMode(emitterId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ewGroupId, modeId }: { ewGroupId: string; modeId: string }) => modesApi.delete(ewGroupId, modeId),
    onSuccess: (_data, variables) => invalidateModes(qc, variables.ewGroupId, emitterId),
  });
}

export function useProposeModeDraft(emitterId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ewGroupId, modeId, input }: { ewGroupId: string; modeId: string; input: ModeDraftInput }) =>
      modesApi.proposeDraft(ewGroupId, modeId, input),
    onSuccess: (_data, variables) => invalidateModes(qc, variables.ewGroupId, emitterId),
  });
}

export function useApproveModeDraft(emitterId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ewGroupId, modeId }: { ewGroupId: string; modeId: string }) => modesApi.approve(ewGroupId, modeId),
    onSuccess: (_data, variables) => invalidateModes(qc, variables.ewGroupId, emitterId),
  });
}

export function useRejectModeDraft(emitterId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ewGroupId, modeId }: { ewGroupId: string; modeId: string }) => modesApi.reject(ewGroupId, modeId),
    onSuccess: (_data, variables) => invalidateModes(qc, variables.ewGroupId, emitterId),
  });
}
