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
}

export interface TestRecordModeResultInput {
  mode_id: string;
  result: TestResult;
  notes?: string;
  observed_values?: ObservedValues[];
}

export interface TestRecordInput {
  test_type: TestType;
  title: string;
  notes?: string;
  test_date: string;
  simulation_created_date?: string;
  /** Per-Mode outcome — the whole-test result is derived from these. */
  mode_results?: TestRecordModeResultInput[];
  /** Only used (and required) when mode_results is empty. */
  result?: TestResult;
  /** Optional pointer to an earlier test record this one re-runs. */
  retests_test_record_id?: string;
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
