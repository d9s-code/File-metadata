import { api } from "./client";
import type { PriType, TestResult, TestType } from "../types/domain";

export interface ObservedValues {
  rf_min_mhz?: number;
  rf_max_mhz?: number;
  pw_min_us?: number;
  pw_max_us?: number;
  /** Which PRI shape was observed — governs which of the fields below apply,
   * mirroring the same fixed/stagger/cw/xlet branches Mode creation uses. */
  pri_type?: PriType;
  /** Fixed only. */
  pri_min_us?: number;
  pri_max_us?: number;
  jitter_min_us?: number;
  jitter_max_us?: number;
  /** Stagger only. */
  pri_stagger_values_us?: number[];
}

export interface TestRecordModeLink {
  mode_id: string;
  mode_name: string;
  link_type: "exercised" | "derived";
  result: TestResult | null;
  notes: string | null;
  /** Zero or more sets — e.g. one per repeated measurement/run. */
  observed_values: ObservedValues[] | null;
}

export interface TestRecordFunctionGroupResult {
  function_group_id: string;
  function_group_name: string;
  computed_result: TestResult;
  override_result: TestResult | null;
}

export interface TestRecordLineResult {
  test_line_id: string;
  test_line_label: string;
  /** pass = correctly intercepted, partial = misclassified, fail = missed, inconclusive = couldn't be assessed. */
  outcome: TestResult;
  /** The Emitter's Modes the system reported for this line — any number. */
  intercepted_modes: { mode_id: string; mode_name: string }[];
  notes: string | null;
  /** Intercepted parameters — zero or more sets. */
  observed_values: ObservedValues[] | null;
}

export interface TestRecord {
  id: string;
  scope_type: "emitter" | "mdf";
  scope_id: string;
  emitter_version_id: string | null;
  mdf_version_id: string | null;
  test_type: TestType;
  result: TestResult;
  title: string;
  notes: string | null;
  tested_by: string | null;
  test_date: string;
  simulation_created_date: string | null;
  created_at: string;
  retests_test_record_id: string | null;
  modes: TestRecordModeLink[];
  function_groups: TestRecordFunctionGroupResult[];
  lines: TestRecordLineResult[];
}

export interface TestRecordModeResultInput {
  mode_id: string;
  result: TestResult;
  notes?: string;
  observed_values?: ObservedValues[];
}

export interface TestRecordLineResultInput {
  test_line_id: string;
  outcome: TestResult;
  intercepted_mode_ids?: string[];
  notes?: string;
  observed_values?: ObservedValues[];
}

export interface TestRecordInput {
  test_type: TestType;
  title: string;
  notes?: string;
  test_date: string;
  simulation_created_date?: string;
  /** Per-Test-Line intercept-correctness outcome — when given, this is what the
   * whole-test result derives from (see backend precedence). */
  line_results?: TestRecordLineResultInput[];
  /** Per-Mode outcome — the whole-test result is derived from these only when
   * line_results is empty. */
  mode_results?: TestRecordModeResultInput[];
  /** Only used (and required) when neither line_results nor mode_results is given. */
  result?: TestResult;
  /** Optional pointer to an earlier test record this one re-runs. */
  retests_test_record_id?: string;
  /** Per-Function-Group manual override of the computed worst-of-N aggregate
   * — a Function Group not present here just gets its computed result. */
  function_group_overrides?: Record<string, TestResult>;
}

export const testRecordsApi = {
  listForEmitter: (emitterId: string) => api.get<TestRecord[]>(`/emitters/${emitterId}/test-records`),
  createForEmitter: (emitterId: string, input: TestRecordInput) =>
    api.post<TestRecord>(`/emitters/${emitterId}/test-records`, input),
  deleteForEmitter: (emitterId: string, id: string) =>
    api.delete<void>(`/emitters/${emitterId}/test-records/${id}`),

  listForMdf: (mdfId: string) => api.get<TestRecord[]>(`/mdfs/${mdfId}/test-records`),
  createForMdf: (mdfId: string, input: TestRecordInput) => api.post<TestRecord>(`/mdfs/${mdfId}/test-records`, input),
  deleteForMdf: (mdfId: string, id: string) => api.delete<void>(`/mdfs/${mdfId}/test-records/${id}`),
};
