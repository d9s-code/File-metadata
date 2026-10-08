import { api } from "./client";
import type { AuditLogEntry, EmitterStatus, TestResult, TestType } from "../types/domain";

export interface NeedsAttentionItem {
  message: string;
  entity_type: "emitter" | "platform" | "mdf" | "intercept";
  entity_id: string;
  category: "stale" | "rework" | "sim" | "mdf" | "intercepts" | "ambiguity" | "locks";
}

export interface PendingApprovalItem {
  message: string;
  kind: "source";
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

/** Latest outcome per SIM Test Line: pass / partial / fail / inconclusive,
 * plus untested for a line no run included yet. */
export type SimOutcomeCounts = Record<"pass" | "partial" | "fail" | "inconclusive" | "untested", number>;

export interface EmitterSimStatus {
  emitter_id: string;
  name: string;
  status: EmitterStatus;
  line_count: number;
  line_outcomes: SimOutcomeCounts;
  last_validated_at: string | null;
  last_validated_result: TestResult | null;
  last_validated_test_record_id: string | null;
  /** Content was committed after the last Simulation Test. */
  changed_since_validation: boolean;
}

export interface RecentTestRun {
  entity_type: "emitter" | "mdf";
  entity_id: string;
  entity_name: string;
  test_record_id: string;
  title: string;
  test_type: TestType;
  result: TestResult;
  test_date: string;
  line_outcomes: Record<TestResult, number> | null;
}

export interface Dashboard {
  emitter_status_counts: Record<string, number>;
  mdf_status_counts: Record<string, number>;
  needs_attention: NeedsAttentionItem[];
  pending_approvals: PendingApprovalItem[];
  sim_line_counts: SimOutcomeCounts;
  emitter_sim_status: EmitterSimStatus[];
  recent_test_runs: RecentTestRun[];
  needs_redo: NeedsRedoTestItem[];
  recent_activity: AuditLogEntry[];
}

export type DashboardOverview = Pick<
  Dashboard,
  "emitter_status_counts" | "mdf_status_counts" | "sim_line_counts" | "emitter_sim_status"
>;
export type DashboardAttention = Pick<Dashboard, "needs_attention" | "pending_approvals">;
export type DashboardTestRuns = Pick<Dashboard, "recent_test_runs" | "needs_redo">;

export interface DashboardAdmin {
  failed_logins_24h: number;
  recent_failed_logins: AuditLogEntry[];
  long_held_locks: NeedsAttentionItem[];
}

export const dashboardApi = {
  get: () => api.get<Dashboard>("/dashboard"),
  // One section per card, so each loads on its own.
  overview: () => api.get<DashboardOverview>("/dashboard/overview"),
  attention: () => api.get<DashboardAttention>("/dashboard/attention"),
  testRuns: () => api.get<DashboardTestRuns>("/dashboard/test-runs"),
  activity: (everything: boolean) =>
    api.get<{ recent_activity: AuditLogEntry[] }>(`/dashboard/activity${everything ? "?everything=true" : ""}`),
  admin: () => api.get<DashboardAdmin>("/dashboard/admin"),
};
