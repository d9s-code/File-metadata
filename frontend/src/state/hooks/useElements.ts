import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { elementsApi, type CartesianProductInput, type ModeElementInput } from "../../api/elements";
import { modesKey } from "./useModes";

export function elementsKey(emitterId: string, sourceId: string) {
  return ["elements", emitterId, sourceId] as const;
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
    onSuccess: () => qc.invalidateQueries({ queryKey: elementsKey(emitterId, sourceId) }),
  });
}

export function useDeleteElement(emitterId: string, sourceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (elementId: string) => elementsApi.delete(emitterId, sourceId, elementId),
    onSuccess: () => qc.invalidateQueries({ queryKey: elementsKey(emitterId, sourceId) }),
  });
}

export function useCartesianProduct(emitterId: string, sourceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CartesianProductInput) => elementsApi.cartesianProduct(emitterId, sourceId, input),
    onSuccess: (_, variables) => {
      qc.invalidateQueries({ queryKey: modesKey(variables.ew_group_id) });
    },
  });
}
