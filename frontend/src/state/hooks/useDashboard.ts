import { useQuery } from "@tanstack/react-query";
import { dashboardApi } from "../../api/dashboard";

export function useDashboard() {
  return useQuery({ queryKey: ["dashboard"], queryFn: () => dashboardApi.get() });
}

export function useActivityTrend(action?: string) {
  return useQuery({
    queryKey: ["dashboard", "activity-trend", action],
    queryFn: () => dashboardApi.activityTrend(action),
  });
}
