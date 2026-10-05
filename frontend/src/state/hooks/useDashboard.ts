import { useQuery } from "@tanstack/react-query";
import { dashboardApi } from "../../api/dashboard";

const key = ["dashboard"] as const;

export function useDashboard() {
  return useQuery({ queryKey: key, queryFn: () => dashboardApi.get() });
}

// Each dashboard card has its own query, so a slow one only holds up itself.

export function useDashboardOverview() {
  return useQuery({ queryKey: [...key, "overview"], queryFn: () => dashboardApi.overview() });
}

export function useDashboardAttention() {
  return useQuery({ queryKey: [...key, "attention"], queryFn: () => dashboardApi.attention() });
}

export function useDashboardTestRuns() {
  return useQuery({ queryKey: [...key, "test-runs"], queryFn: () => dashboardApi.testRuns() });
}

export function useDashboardActivity(everything: boolean) {
  return useQuery({ queryKey: [...key, "activity", everything], queryFn: () => dashboardApi.activity(everything) });
}

export function useDashboardAdmin(enabled: boolean) {
  return useQuery({ queryKey: [...key, "admin"], queryFn: () => dashboardApi.admin(), enabled });
}
