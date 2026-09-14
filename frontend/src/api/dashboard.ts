import { api } from "./client";
import type { AuditLogEntry } from "../types/domain";

export interface NeedsAttentionItem {
  message: string;
  entity_type: "emitter" | "mdf";
  entity_id: string;
}

export interface PendingApprovalItem {
  message: string;
  kind: "source" | "mode";
  emitter_id: string;
}

export interface NeedsRedoTestItem {
  entity_type: "emitter" | "mdf";
  entity_id: string;
  entity_name: string;
  test_record_id: string;
  title: string;
  result: string;
  test_date: string;
}

export interface ActivityTrendPoint {
  date: string;
  count: number;
}

export interface Dashboard {
  emitter_status_counts: Record<string, number>;
  mdf_status_counts: Record<string, number>;
  needs_attention: NeedsAttentionItem[];
  pending_approvals: PendingApprovalItem[];
  modes_passing_total: number;
  modes_total: number;
  test_result_counts: Record<string, number>;
  needs_redo: NeedsRedoTestItem[];
  recent_activity: AuditLogEntry[];
  activity_trend: ActivityTrendPoint[];
}

export const dashboardApi = {
  get: () => api.get<Dashboard>("/dashboard"),
  activityTrend: (action?: string) =>
    api.get<ActivityTrendPoint[]>(`/dashboard/activity-trend${action ? `?action=${action}` : ""}`),
};
