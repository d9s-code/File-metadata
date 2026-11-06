import type { ChangeNotes } from "./mdfPlan";
import { api } from "./client";
import type { AuditLogEntry, EmitterStatus, TestResult, TestType } from "../types/domain";

export interface NeedsAttentionItem {
  message: string;
  entity_type: "emitter" | "platform" | "mdf" | "intercept" | "dwell_strategy";
  entity_id: string;
  category: "stale" | "rework" | "sim" | "mdf" | "intercepts" | "ambiguity" | "locks" | "dwell";
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
 * plus untested for a line no run included yet, and outdated for one whose
 * latest result named Modes since deleted. */
export type SimOutcomeCounts = Record<"pass" | "partial" | "fail" | "inconclusive" | "outdated" | "untested", number>;

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
export type DashboardAttention = Pick<Dashboard, "needs_attention">;
export type DashboardTestRuns = Pick<Dashboard, "recent_test_runs" | "needs_redo">;

export interface DashboardAdmin {
  failed_logins_24h: number;
  recent_failed_logins: AuditLogEntry[];
  long_held_locks: NeedsAttentionItem[];
}

/** The MDF the dashboard is about: pinned by an admin, else the most recently
 * changed MDF that isn't released. */
export interface ReleaseMdf {
  id: string;
  name: string;
  status: string;
  due_date: string | null;
  customer: string | null;
  based_on_mdf_name: string | null;
  based_on_version_number: number | null;
  latest_version: number | null;
}

/** An Emitter on the current MDF — once, however many Platforms carry it. */
export interface ReleaseEmitter {
  emitter_id: string;
  name: string;
  designation: string | null;
  status: string | null;
  pinned_version: number;
  latest_version: number | null;
  platforms: string[];
  assignee: string | null;
  sim: EmitterSimStatus | null;
}

export interface DashboardRelease {
  mdf: ReleaseMdf | null;
  pinned: boolean;
  emitters: ReleaseEmitter[];
  /** What the customer will get: the change notes the MDF's summary counts. */
  changes: { since: string; to_version: number; change_notes: ChangeNotes } | null;
}

/** Counts of what needs a look across everything; failed sign-ins for admins only. */
export interface DashboardHealth {
  ambiguity: number;
  intercepts: number;
  held_for_editing: number;
  dwell_testing: number;
  failed_logins_24h: number | null;
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
  release: () => api.get<DashboardRelease>("/dashboard/release"),
  health: () => api.get<DashboardHealth>("/dashboard/health"),
  /** Admins: pin the MDF the dashboard is about; null unpins it. */
  pinCurrentMdf: (mdfId: string | null) => api.put<DashboardRelease>("/dashboard/current-mdf", { mdf_id: mdfId }),
};
