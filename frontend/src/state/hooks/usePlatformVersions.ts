import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { platformVersionsApi } from "../../api/platformVersions";

export function platformVersionsKey(platformId: string) {
  return ["platformVersions", platformId] as const;
}

export function usePlatformVersions(platformId: string) {
  return useQuery({
    queryKey: platformVersionsKey(platformId),
    queryFn: () => platformVersionsApi.list(platformId),
    enabled: !!platformId,
  });
}

export function usePlatformVersionDiff(platformId: string, versionNumber: number, against?: number) {
  return useQuery({
    queryKey: [...platformVersionsKey(platformId), versionNumber, "diff", against],
    queryFn: () => platformVersionsApi.diff(platformId, versionNumber, against),
    enabled: !!platformId && versionNumber > 1,
  });
}

export function useCommitPlatformVersion(platformId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (changeSummary?: string) => platformVersionsApi.commit(platformId, changeSummary),
    onSuccess: () => qc.invalidateQueries({ queryKey: platformVersionsKey(platformId) }),
  });
}
