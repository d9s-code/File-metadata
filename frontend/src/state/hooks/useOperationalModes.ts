import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  operationalModesApi,
  type GenerateFromPlanInput,
  type OperationalModeInput,
  type SetValuesInput,
} from "../../api/operationalModes";
import { emitterVersionsKey } from "./useEmitterVersions";

export function operationalModesKey(emitterId: string) {
  return ["operationalModes", emitterId] as const;
}

export function useOperationalModes(emitterId: string) {
  return useQuery({
    queryKey: operationalModesKey(emitterId),
    queryFn: () => operationalModesApi.list(emitterId),
    enabled: !!emitterId,
  });
}

/** After a change: the list, the Modes that name them, and the Emitter's unsaved changes. */
function useInvalidate(emitterId: string) {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: operationalModesKey(emitterId) });
    void qc.invalidateQueries({ queryKey: ["modes"] });
    void qc.invalidateQueries({ queryKey: emitterVersionsKey(emitterId) });
  };
}

export function useCreateOperationalMode(emitterId: string) {
  const invalidate = useInvalidate(emitterId);
  return useMutation({
    mutationFn: (input: OperationalModeInput) => operationalModesApi.create(emitterId, input),
    onSuccess: invalidate,
  });
}

export function useUpdateOperationalMode(emitterId: string) {
  const invalidate = useInvalidate(emitterId);
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<OperationalModeInput> }) =>
      operationalModesApi.update(emitterId, id, input),
    onSuccess: invalidate,
  });
}

/** Puts one parent's operational modes in an order. */
export function useOrderOperationalModes(emitterId: string) {
  const invalidate = useInvalidate(emitterId);
  return useMutation({
    mutationFn: ({ parentId, ids }: { parentId: string | null; ids: string[] }) => operationalModesApi.order(emitterId, parentId, ids),
    onSuccess: invalidate,
  });
}

/** Sets values on every Mode under an operational mode. */
export function useSetValuesBelow(emitterId: string) {
  const invalidate = useInvalidate(emitterId);
  return useMutation({
    mutationFn: ({ id, values }: { id: string; values: SetValuesInput }) => operationalModesApi.setValues(emitterId, id, values),
    onSuccess: invalidate,
  });
}

export function useDeleteOperationalMode(emitterId: string) {
  const invalidate = useInvalidate(emitterId);
  return useMutation({
    mutationFn: (id: string) => operationalModesApi.delete(emitterId, id),
    onSuccess: invalidate,
  });
}

/** Modes made from a plan's combinations. */
export function useGenerateFromPlan(emitterId: string) {
  const invalidate = useInvalidate(emitterId);
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: GenerateFromPlanInput }) => operationalModesApi.generate(emitterId, id, input),
    onSuccess: invalidate,
  });
}

const commentsKey = (emitterId: string) => ["planComments", emitterId] as const;

export function usePlanComments(emitterId: string) {
  return useQuery({ queryKey: commentsKey(emitterId), queryFn: () => operationalModesApi.comments(emitterId), enabled: !!emitterId });
}

/** Adding, editing, resolving and deleting comments — all refresh the list. */
export function usePlanCommentActions(emitterId: string) {
  const qc = useQueryClient();
  const done = () => void qc.invalidateQueries({ queryKey: commentsKey(emitterId) });
  return {
    add: useMutation({
      mutationFn: (input: { body: string; operational_mode_id?: string | null; parent_id?: string | null }) =>
        operationalModesApi.addComment(emitterId, input),
      onSuccess: done,
    }),
    update: useMutation({
      mutationFn: ({ id, input }: { id: string; input: { body?: string; resolved?: boolean } }) =>
        operationalModesApi.updateComment(emitterId, id, input),
      onSuccess: done,
    }),
    remove: useMutation({ mutationFn: (id: string) => operationalModesApi.deleteComment(emitterId, id), onSuccess: done }),
  };
}
