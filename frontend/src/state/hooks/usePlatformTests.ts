import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { platformTestsApi, type PlatformTestInput } from "../../api/platformTests";
import { testDraftsApi } from "../../api/testRecords";

export const platformTestsKey = (platformId: string) => ["platformTests", platformId] as const;
export const platformTestDraftsKey = (platformId: string) => ["platformTestDrafts", platformId] as const;

export function usePlatformTests(platformId: string) {
  return useQuery({ queryKey: platformTestsKey(platformId), queryFn: () => platformTestsApi.list(platformId), enabled: !!platformId });
}

/** Platform tests in progress. */
export function usePlatformTestDrafts(platformId: string) {
  return useQuery({
    queryKey: platformTestDraftsKey(platformId),
    queryFn: () => platformTestsApi.listDrafts(platformId),
    enabled: !!platformId,
  });
}

export function useLogPlatformTest(platformId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: PlatformTestInput) => platformTestsApi.create(platformId, input),
    onSuccess: (test) => {
      qc.invalidateQueries({ queryKey: platformTestsKey(platformId) });
      qc.invalidateQueries({ queryKey: platformTestDraftsKey(platformId) });
      for (const e of test.emitters) qc.invalidateQueries({ queryKey: ["testRecords", "emitter", e.emitter_id] });
    },
  });
}

export function useDiscardPlatformTestDraft(platformId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => testDraftsApi.discard(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: platformTestDraftsKey(platformId) }),
  });
}
