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

/** Whether a language model is set up on the server — the AI buttons show only if so. */
export function useAiStatus({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({ queryKey: ["aiStatus"], queryFn: () => ambiguityApi.aiStatus(), staleTime: 5 * 60_000, enabled });
}

/** Admin: copy the documentation from Outline now. */
export function useSyncDocumentation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => ambiguityApi.syncDocumentation(),
    onSettled: () => qc.invalidateQueries({ queryKey: ["aiStatus"] }),
  });
}

export function useExplainFinding(runId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ findingId, refresh }: { findingId: string; refresh?: boolean }) =>
      ambiguityApi.explainFinding(findingId, refresh),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ambiguityFindings", runId] }),
  });
}

export function useSummariseRun(runId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (refresh: boolean) => ambiguityApi.summariseRun(runId, refresh),
    onSuccess: (run) => qc.setQueryData(["ambiguityRun", runId], run),
  });
}

export function useMergePreview(findingId: string, keep: "a" | "b" | null) {
  return useQuery({
    queryKey: ["ambiguityMergePreview", findingId, keep],
    queryFn: () => ambiguityApi.mergePreview(findingId, keep as "a" | "b"),
    enabled: !!keep,
    retry: false,
  });
}

export function useMergeFinding(runId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ findingId, keep }: { findingId: string; keep: "a" | "b" }) => ambiguityApi.merge(findingId, keep),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ambiguityFindings", runId] });
      qc.invalidateQueries({ queryKey: ["ambiguityMergePreview"] });
      // The Emitter's Modes changed.
      qc.invalidateQueries({ queryKey: ["emitters"] });
      qc.invalidateQueries({ queryKey: ["modes"] });
    },
  });
}
