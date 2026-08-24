import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { modeBatchesApi } from "../../api/modeBatches";
import { emitterModesKey } from "./useModes";

export function emitterBatchesKey(emitterId: string) {
  return ["modeBatches", emitterId] as const;
}

export function useEmitterBatches(emitterId: string) {
  return useQuery({ queryKey: emitterBatchesKey(emitterId), queryFn: () => modeBatchesApi.listByEmitter(emitterId) });
}

export function useDeleteBatch(emitterId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (batchId: string) => modeBatchesApi.delete(emitterId, batchId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: emitterBatchesKey(emitterId) });
      qc.invalidateQueries({ queryKey: emitterModesKey(emitterId) });
    },
  });
}
