import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { mdfsApi, type MdfCreateInput } from "../../api/mdfs";

export const mdfsKey = ["mdfs"] as const;

export function useMdfs() {
  return useQuery({ queryKey: mdfsKey, queryFn: () => mdfsApi.list() });
}

export function useMdf(id: string | undefined) {
  return useQuery({ queryKey: [...mdfsKey, id], queryFn: () => mdfsApi.get(id as string), enabled: !!id });
}

export function useCreateMdf() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: MdfCreateInput) => mdfsApi.create(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: mdfsKey }),
  });
}

export function useUpdateMdf() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<MdfCreateInput> }) => mdfsApi.update(id, input),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: mdfsKey });
      qc.invalidateQueries({ queryKey: [...mdfsKey, variables.id] });
    },
  });
}

export function useDeleteMdf() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, hard }: { id: string; hard?: boolean }) => mdfsApi.delete(id, hard),
    onSuccess: () => qc.invalidateQueries({ queryKey: mdfsKey }),
  });
}

export function useRestoreMdf() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => mdfsApi.restore(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: mdfsKey }),
  });
}

export function mdfLinksKey(mdfId: string) {
  return ["mdfLinks", mdfId] as const;
}

export function mdfReadinessKey(mdfId: string) {
  return ["mdfReadiness", mdfId] as const;
}

export function mdfReadinessChecklistKey(mdfId: string) {
  return ["mdfReadinessChecklist", mdfId] as const;
}

/** The MDF's readiness checklist — refetched whenever it's shown. */
export function useMdfReadinessChecklist(mdfId: string) {
  return useQuery({
    queryKey: mdfReadinessChecklistKey(mdfId),
    queryFn: () => mdfsApi.getReadinessChecklist(mdfId),
    enabled: !!mdfId,
    staleTime: 0,
  });
}

/** Moves every pinned Platform with a newer saved version to that version. */
export function useRepinMdfLatest(mdfId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => mdfsApi.repinLatest(mdfId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: mdfLinksKey(mdfId) });
      qc.invalidateQueries({ queryKey: mdfReadinessKey(mdfId) });
      qc.invalidateQueries({ queryKey: mdfReadinessChecklistKey(mdfId) });
    },
  });
}

export function useMdfLinks(mdfId: string) {
  return useQuery({ queryKey: mdfLinksKey(mdfId), queryFn: () => mdfsApi.listLinks(mdfId), enabled: !!mdfId });
}

export function usePinPlatform(mdfId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ platformId, platformVersionId }: { platformId: string; platformVersionId: string }) =>
      mdfsApi.pinPlatform(mdfId, platformId, platformVersionId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: mdfLinksKey(mdfId) });
      qc.invalidateQueries({ queryKey: mdfReadinessKey(mdfId) });
      qc.invalidateQueries({ queryKey: mdfReadinessChecklistKey(mdfId) });
    },
  });
}

export function useUnpinPlatform(mdfId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (platformId: string) => mdfsApi.unpinPlatform(mdfId, platformId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: mdfLinksKey(mdfId) });
      qc.invalidateQueries({ queryKey: mdfReadinessKey(mdfId) });
    },
  });
}

export function useMdfReadiness(mdfId: string) {
  return useQuery({
    queryKey: mdfReadinessKey(mdfId),
    queryFn: () => mdfsApi.getReadiness(mdfId),
    enabled: !!mdfId,
  });
}

export function useTransitionMdfStatus(mdfId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ newStatus, note, confirmUnmet }: { newStatus: string; note?: string; confirmUnmet?: boolean }) =>
      mdfsApi.transitionStatus(mdfId, newStatus, note, confirmUnmet),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [...mdfsKey, mdfId] });
      qc.invalidateQueries({ queryKey: mdfsKey });
      qc.invalidateQueries({ queryKey: mdfReadinessKey(mdfId) });
    },
  });
}
