import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { emitterVersionsApi } from "../../api/emitterVersions";
import { emittersKey } from "./useEmitters";

export function emitterVersionsKey(emitterId: string) {
  return ["emitterVersions", emitterId] as const;
}

export function useEmitterVersions(emitterId: string) {
  return useQuery({
    queryKey: emitterVersionsKey(emitterId),
    queryFn: () => emitterVersionsApi.list(emitterId),
    enabled: !!emitterId,
  });
}

export function useEmitterVersionDiff(emitterId: string, versionNumber: number, against?: number) {
  return useQuery({
    queryKey: [...emitterVersionsKey(emitterId), versionNumber, "diff", against],
    queryFn: () => emitterVersionsApi.diff(emitterId, versionNumber, against),
    enabled: !!emitterId && versionNumber > 1,
  });
}

export function useCommitEmitterVersion(emitterId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (changeSummary?: string) => emitterVersionsApi.commit(emitterId, changeSummary),
    onSuccess: () => qc.invalidateQueries({ queryKey: emitterVersionsKey(emitterId) }),
  });
}

export function useTransitionEmitterStatus(emitterId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ newStatus, note }: { newStatus: string; note?: string }) =>
      emitterVersionsApi.transitionStatus(emitterId, newStatus, note),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: emitterVersionsKey(emitterId) });
      qc.invalidateQueries({ queryKey: [...emittersKey, emitterId] });
      qc.invalidateQueries({ queryKey: emittersKey });
    },
  });
}
