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

export function mdfLinksKey(mdfId: string) {
  return ["mdfLinks", mdfId] as const;
}

export function mdfReadinessKey(mdfId: string) {
  return ["mdfReadiness", mdfId] as const;
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
    mutationFn: ({ newStatus, note }: { newStatus: string; note?: string }) =>
      mdfsApi.transitionStatus(mdfId, newStatus, note),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [...mdfsKey, mdfId] });
      qc.invalidateQueries({ queryKey: mdfsKey });
      qc.invalidateQueries({ queryKey: mdfReadinessKey(mdfId) });
    },
  });
}
