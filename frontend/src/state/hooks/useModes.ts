import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { modesApi, type ModeBatchEditInput, type ModeCreateInput, type ModeUpdateInput } from "../../api/modes";
import { dslApi, type ModeFromDslInput } from "../../api/dsl";
import { emitterVersionsKey } from "./useEmitterVersions";

export function modesKey(ewGroupId: string) {
  return ["modes", ewGroupId] as const;
}

export function emitterModesKey(emitterId: string) {
  return ["modes", "emitter", emitterId] as const;
}

export function useModes(ewGroupId: string) {
  return useQuery({
    queryKey: modesKey(ewGroupId),
    queryFn: () => modesApi.list(ewGroupId),
  });
}

export function useEmitterModes(emitterId: string) {
  return useQuery({
    queryKey: emitterModesKey(emitterId),
    queryFn: () => modesApi.listByEmitter(emitterId),
  });
}

function invalidateModes(qc: ReturnType<typeof useQueryClient>, ewGroupId: string, emitterId: string) {
  qc.invalidateQueries({ queryKey: ["modes", ewGroupId] });
  qc.invalidateQueries({ queryKey: ["modes", "emitter", emitterId] });
  // A Mode edit changes what the live-vs-last-commit diff would show, so an
  // open "View changes since last commit" panel must refetch too.
  qc.invalidateQueries({ queryKey: emitterVersionsKey(emitterId) });
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

export function useUpdateMode(emitterId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ewGroupId, modeId, input }: { ewGroupId: string; modeId: string; input: ModeUpdateInput }) =>
      modesApi.update(ewGroupId, modeId, input),
    onSuccess: (_data, variables) => invalidateModes(qc, variables.ewGroupId, emitterId),
  });
}

export function useBatchEditModes(emitterId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ModeBatchEditInput) => modesApi.batchEdit(emitterId, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: emitterModesKey(emitterId) });
      qc.invalidateQueries({ queryKey: emitterVersionsKey(emitterId) });
    },
  });
}

export function useDeleteMode(emitterId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ewGroupId, modeId }: { ewGroupId: string; modeId: string }) => modesApi.delete(ewGroupId, modeId),
    onSuccess: (_data, variables) => invalidateModes(qc, variables.ewGroupId, emitterId),
  });
}
