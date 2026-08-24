import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { modesApi, type ModeCreateInput } from "../../api/modes";
import { dslApi, type ModeFromDslInput } from "../../api/dsl";

export function modesKey(ewGroupId: string) {
  return ["modes", ewGroupId] as const;
}

export function emitterModesKey(emitterId: string) {
  return ["modes", "emitter", emitterId] as const;
}

export function useModes(ewGroupId: string) {
  return useQuery({ queryKey: modesKey(ewGroupId), queryFn: () => modesApi.list(ewGroupId) });
}

export function useEmitterModes(emitterId: string) {
  return useQuery({ queryKey: emitterModesKey(emitterId), queryFn: () => modesApi.listByEmitter(emitterId) });
}

function invalidateModes(qc: ReturnType<typeof useQueryClient>, ewGroupId: string, emitterId: string) {
  qc.invalidateQueries({ queryKey: modesKey(ewGroupId) });
  qc.invalidateQueries({ queryKey: emitterModesKey(emitterId) });
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
