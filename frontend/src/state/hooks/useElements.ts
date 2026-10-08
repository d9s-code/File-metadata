import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { elementsApi, type CartesianProductInput, type ModeElementInput } from "../../api/elements";
import { emitterModesKey, modesKey } from "./useModes";
import { emitterBatchesKey } from "./useModeBatches";

export function elementsKey(emitterId: string, sourceId: string) {
  return ["elements", emitterId, sourceId] as const;
}

export function elementOverviewKey(emitterId: string) {
  return ["element-overview", emitterId] as const;
}

export function cartesianRunsKey(emitterId: string, sourceId: string) {
  return ["cartesian-runs", emitterId, sourceId] as const;
}

/** Every distinct Element across the Emitter's Sources. */
export function useElementOverview(emitterId: string) {
  return useQuery({ queryKey: elementOverviewKey(emitterId), queryFn: () => elementsApi.overview(emitterId) });
}

/** A Source's generation log. */
export function useCartesianRuns(emitterId: string, sourceId: string) {
  return useQuery({
    queryKey: cartesianRunsKey(emitterId, sourceId),
    queryFn: () => elementsApi.cartesianRuns(emitterId, sourceId),
  });
}

export function useElements(emitterId: string, sourceId: string) {
  return useQuery({
    queryKey: elementsKey(emitterId, sourceId),
    queryFn: () => elementsApi.list(emitterId, sourceId),
    enabled: !!sourceId,
  });
}

export function useCreateElement(emitterId: string, sourceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ModeElementInput) => elementsApi.create(emitterId, sourceId, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: elementsKey(emitterId, sourceId) });
      qc.invalidateQueries({ queryKey: elementOverviewKey(emitterId) });
    },
  });
}

export function useDeleteElement(emitterId: string, sourceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (elementId: string) => elementsApi.delete(emitterId, sourceId, elementId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: elementsKey(emitterId, sourceId) });
      qc.invalidateQueries({ queryKey: elementOverviewKey(emitterId) });
    },
  });
}

export function useCartesianProduct(emitterId: string, sourceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CartesianProductInput) => elementsApi.cartesianProduct(emitterId, sourceId, input),
    onSuccess: (_, variables) => {
      qc.invalidateQueries({ queryKey: modesKey(variables.ew_group_id) });
      qc.invalidateQueries({ queryKey: emitterModesKey(emitterId) });
      qc.invalidateQueries({ queryKey: emitterBatchesKey(emitterId) });
      qc.invalidateQueries({ queryKey: cartesianRunsKey(emitterId, sourceId) });
    },
  });
}
