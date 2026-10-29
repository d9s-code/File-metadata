import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  modesApi,
  type ModeBatchEditInput,
  type InterceptModePlanInput,
  type ModeCreateInput,
} from "../../api/modes";
import { dslApi, type ModeFromDslInput } from "../../api/dsl";
import { emitterVersionsKey } from "./useEmitterVersions";
import { emitterBatchesKey } from "./useModeBatches";
import { testRecordsKey } from "./useTestRecords";
import { testLinesKey } from "./useTestLines";
import { emittersKey } from "./useEmitters";

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
    // Callers pass "" until they know the Emitter (e.g. an Intercept still loading).
    enabled: !!emitterId,
  });
}

function invalidateModes(qc: ReturnType<typeof useQueryClient>, ewGroupId: string, emitterId: string) {
  qc.invalidateQueries({ queryKey: ["modes", ewGroupId] });
  qc.invalidateQueries({ queryKey: ["modes", "emitter", emitterId] });
  // A Mode edit changes what the live-vs-last-commit diff would show, so an
  // open "View changes since last save" panel must refetch too.
  qc.invalidateQueries({ queryKey: emitterVersionsKey(emitterId) });
  // An Intercept entry lists the Modes created from it, and is matched
  // against the Emitter's Modes.
  qc.invalidateQueries({ queryKey: ["intercept-entries"] });
  invalidateSimResults(qc, emitterId);
}

/** A deleted Mode puts the SIM results that named it out of date. */
export function invalidateSimResults(qc: ReturnType<typeof useQueryClient>, emitterId: string) {
  qc.invalidateQueries({ queryKey: testLinesKey(emitterId) });
  qc.invalidateQueries({ queryKey: emittersKey });
}

export function useCreateMode(ewGroupId: string, emitterId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ModeCreateInput) => modesApi.create(ewGroupId, input),
    onSuccess: () => invalidateModes(qc, ewGroupId, emitterId),
  });
}

export function useUpdateMode(emitterId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ewGroupId, modeId, input }: { ewGroupId: string; modeId: string; input: any }) =>
      modesApi.update(ewGroupId, modeId, input),
    onSuccess: (_data, variables) => invalidateModes(qc, variables.ewGroupId, emitterId),
  });
}

export function useCreateModeFromDsl(ewGroupId: string, emitterId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ModeFromDslInput) => dslApi.createModeFromDsl(ewGroupId, input),
    onSuccess: () => invalidateModes(qc, ewGroupId, emitterId),
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

/** Adds one parameter value across the picked combinations of the Modes. */
export function useAddParameter(emitterId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof modesApi.addParameter>[1]) => modesApi.addParameter(emitterId, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["modes"] });
      qc.invalidateQueries({ queryKey: emitterVersionsKey(emitterId) });
      qc.invalidateQueries({ queryKey: testRecordsKey("emitter", emitterId) });
      qc.invalidateQueries({ queryKey: emitterBatchesKey(emitterId) });
    },
  });
}

export function useBatchDeleteModes(emitterId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (modeIds: string[]) => modesApi.batchDelete(emitterId, modeIds),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["modes"] });
      qc.invalidateQueries({ queryKey: emitterVersionsKey(emitterId) });
      qc.invalidateQueries({ queryKey: ["intercept-entries"] });
      invalidateSimResults(qc, emitterId);
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

/** Modes from an Intercept's entries, one per entry, in one generation batch. */
/** Applies a plan from an Intercept's planning page: new Modes into one EW
 * Group, and widened Modes in any of the Emitter's EW Groups. */
export function useApplyInterceptModePlan(emitterId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ewGroupId, input }: { ewGroupId: string; input: InterceptModePlanInput }) =>
      modesApi.applyInterceptPlan(ewGroupId, input),
    onSuccess: (result, { ewGroupId }) => {
      invalidateModes(qc, ewGroupId, emitterId);
      for (const m of result.widened) qc.invalidateQueries({ queryKey: ["modes", m.ew_group_id] });
      qc.invalidateQueries({ queryKey: ["modeBatches", emitterId] });
    },
  });
}

