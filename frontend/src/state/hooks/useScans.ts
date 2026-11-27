import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { scansApi, type EmitterScanInput } from "../../api/scans";
import { emitterVersionsKey } from "./useEmitterVersions";
import { operationalModesKey } from "./useOperationalModes";

export function scansKey(emitterId: string) {
  return ["scans", emitterId] as const;
}

export function useScans(emitterId: string) {
  return useQuery({ queryKey: scansKey(emitterId), queryFn: () => scansApi.list(emitterId), enabled: !!emitterId });
}

/** After a change: the list, what uses them, and the Emitter's unsaved changes. */
function useInvalidate(emitterId: string) {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: scansKey(emitterId) });
    void qc.invalidateQueries({ queryKey: operationalModesKey(emitterId) });
    void qc.invalidateQueries({ queryKey: ["modes"] });
    void qc.invalidateQueries({ queryKey: emitterVersionsKey(emitterId) });
  };
}

export function useCreateScan(emitterId: string) {
  const invalidate = useInvalidate(emitterId);
  return useMutation({ mutationFn: (input: EmitterScanInput) => scansApi.create(emitterId, input), onSuccess: invalidate });
}

export function useUpdateScan(emitterId: string) {
  const invalidate = useInvalidate(emitterId);
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<EmitterScanInput> }) => scansApi.update(emitterId, id, input),
    onSuccess: invalidate,
  });
}

export function useDeleteScan(emitterId: string) {
  const invalidate = useInvalidate(emitterId);
  return useMutation({ mutationFn: (id: string) => scansApi.delete(emitterId, id), onSuccess: invalidate });
}
