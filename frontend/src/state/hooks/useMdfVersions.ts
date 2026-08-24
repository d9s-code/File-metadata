import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { mdfVersionsApi } from "../../api/mdfVersions";

export function mdfVersionsKey(mdfId: string) {
  return ["mdfVersions", mdfId] as const;
}

export function useMdfVersions(mdfId: string) {
  return useQuery({ queryKey: mdfVersionsKey(mdfId), queryFn: () => mdfVersionsApi.list(mdfId), enabled: !!mdfId });
}

export function useMdfVersionDiff(mdfId: string, versionNumber: number, against?: number) {
  return useQuery({
    queryKey: [...mdfVersionsKey(mdfId), versionNumber, "diff", against],
    queryFn: () => mdfVersionsApi.diff(mdfId, versionNumber, against),
    enabled: !!mdfId && versionNumber > 1,
  });
}

export function useCommitMdfVersion(mdfId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (changeSummary?: string) => mdfVersionsApi.commit(mdfId, changeSummary),
    onSuccess: () => qc.invalidateQueries({ queryKey: mdfVersionsKey(mdfId) }),
  });
}
