import { api } from "./client";
import type { AuditLogEntry, EmitterStatus, TestResult, TestType } from "../types/domain";

export interface NeedsAttentionItem {
  message: string;
  entity_type: "emitter" | "mdf";
  entity_id: string;
  category: "stale" | "rework" | "sim" | "mdf";
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
  /** Content was committed after the last simulation test. */
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

export const dashboardApi = {
  get: () => api.get<Dashboard>("/dashboard"),
};
