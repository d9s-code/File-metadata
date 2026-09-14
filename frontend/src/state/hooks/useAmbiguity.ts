import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ambiguityApi, type AmbiguityRunCreateInput, type AmbiguityScopeType } from "../../api/ambiguity";

export function useCreateAmbiguityRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: AmbiguityRunCreateInput) => ambiguityApi.createRun(input),
    onSuccess: (run) => qc.invalidateQueries({ queryKey: ["ambiguityRuns", run.scope_type, run.scope_id] }),
  });
}

export function useAmbiguityRun(runId: string | null) {
  return useQuery({
    queryKey: ["ambiguityRun", runId],
    queryFn: () => ambiguityApi.getRun(runId as string),
    enabled: !!runId,
    // Poll while the background task is still running.
    refetchInterval: (query) => (query.state.data?.status === "pending" ? 1000 : false),
  });
}

export function useAmbiguityRuns(scopeType: AmbiguityScopeType, scopeId: string) {
  return useQuery({
    queryKey: ["ambiguityRuns", scopeType, scopeId],
    queryFn: () => ambiguityApi.listRuns(scopeType, scopeId),
    enabled: !!scopeId,
  });
}

export function useAmbiguityFindings(runId: string | null) {
  return useQuery({
    queryKey: ["ambiguityFindings", runId],
    queryFn: () => ambiguityApi.listFindings(runId as string),
    enabled: !!runId,
  });
}

export function useReviewFinding(runId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ findingId, note }: { findingId: string; note?: string }) =>
      ambiguityApi.reviewFinding(findingId, note),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ambiguityFindings", runId] }),
  });
}

export function useUnreviewFinding(runId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (findingId: string) => ambiguityApi.unreviewFinding(findingId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ambiguityFindings", runId] }),
  });
}
