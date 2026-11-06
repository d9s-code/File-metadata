import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { dashboardApi } from "../../api/dashboard";

const key = ["dashboard"] as const;

// Each dashboard card has its own query, so a slow one only holds up itself.

export function useDashboardTestRuns() {
  return useQuery({ queryKey: [...key, "test-runs"], queryFn: () => dashboardApi.testRuns() });
}

export function useDashboardRelease() {
  return useQuery({ queryKey: [...key, "release"], queryFn: () => dashboardApi.release() });
}

export function useDashboardHealth() {
  return useQuery({ queryKey: [...key, "health"], queryFn: () => dashboardApi.health() });
}

/** Admins: pin (or unpin, with null) the MDF the dashboard is about. */
export function usePinCurrentMdf() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (mdfId: string | null) => dashboardApi.pinCurrentMdf(mdfId),
    onSuccess: (release) => qc.setQueryData([...key, "release"], release),
  });
}
