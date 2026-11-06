import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { mdfPlanApi, type LogKind, type SummaryFrom } from "../../api/mdfPlan";

const goalsKey = (mdfId: string) => ["mdf-goals", mdfId] as const;
const logKey = (mdfId: string) => ["mdf-log", mdfId] as const;

/** After any change to an MDF's plan: its goals, log, header counts, summary and audit. */
function useRefresh(mdfId: string) {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: goalsKey(mdfId) });
    qc.invalidateQueries({ queryKey: logKey(mdfId) });
    qc.invalidateQueries({ queryKey: ["mdf-summary", mdfId] });
    qc.invalidateQueries({ queryKey: ["mdfs"] });
    qc.invalidateQueries({ queryKey: ["mdfVersions", mdfId] });
    qc.invalidateQueries({ queryKey: ["auditLog"] });
  };
}

export function useMdfGoals(mdfId: string) {
  return useQuery({ queryKey: goalsKey(mdfId), queryFn: () => mdfPlanApi.goals(mdfId), enabled: !!mdfId });
}

export function useMdfLog(mdfId: string) {
  return useQuery({ queryKey: logKey(mdfId), queryFn: () => mdfPlanApi.log(mdfId), enabled: !!mdfId });
}

export function useMdfSummary(mdfId: string, from: SummaryFrom, to: number | null, enabled: boolean) {
  return useQuery({
    queryKey: ["mdf-summary", mdfId, from, to],
    queryFn: () => mdfPlanApi.summary(mdfId, from, to),
    enabled: !!mdfId && enabled,
  });
}

export function useMdfPlanMutations(mdfId: string) {
  const refresh = useRefresh(mdfId);
  return {
    addGoal: useMutation({ mutationFn: (text: string) => mdfPlanApi.addGoal(mdfId, text), onSuccess: refresh }),
    updateGoal: useMutation({
      mutationFn: ({ id, ...input }: { id: string; text?: string; done?: boolean; note?: string | null }) =>
        mdfPlanApi.updateGoal(mdfId, id, input),
      onSuccess: refresh,
    }),
    reorderGoals: useMutation({ mutationFn: (ids: string[]) => mdfPlanApi.reorderGoals(mdfId, ids), onSettled: refresh }),
    deleteGoal: useMutation({ mutationFn: (id: string) => mdfPlanApi.deleteGoal(mdfId, id), onSuccess: refresh }),
    addLog: useMutation({
      mutationFn: ({ kind, body }: { kind: LogKind; body: string }) => mdfPlanApi.addLog(mdfId, kind, body),
      onSuccess: refresh,
    }),
    deleteLog: useMutation({ mutationFn: (id: string) => mdfPlanApi.deleteLog(mdfId, id), onSuccess: refresh }),
    setReleaseNotes: useMutation({
      mutationFn: ({ version, text }: { version: number; text: string | null }) => mdfPlanApi.setReleaseNotes(mdfId, version, text),
      onSuccess: refresh,
    }),
  };
}

/** The pins changed since the latest saved version. `signature` changes
 * whenever the pins or versions do, so it's asked again then. */
export function useUnsavedPins(kind: "platform" | "mdf", id: string, signature: string) {
  return useQuery({
    queryKey: ["unsaved-pins", kind, id, signature],
    queryFn: () => mdfPlanApi.unsaved(kind, id),
    enabled: !!id,
  });
}
