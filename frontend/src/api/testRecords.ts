import { api } from "./client";
import type { PriType, TestResult, TestType } from "../types/domain";

/** One set of intercepted parameters. Logged as means; the min/max keys are
 * only on sets logged before that. */
export interface ObservedValues {
  rf_mean_mhz?: number;
  pw_mean_us?: number;
  /** Fixed only. */
  pri_mean_us?: number;
  /** Fixed only. */
  jitter_mean_us?: number;
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
  /** Stagger only — the observed frame time, when it was measured directly. */
  frame_time_us?: number;
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

export interface TestRecordLineResult {
  test_line_id: string;
  test_line_label: string;
  /** pass = correctly intercepted, partial = partly recognised (e.g. reported as the wrong Mode), fail = missed, inconclusive = couldn't be assessed. */
  outcome: TestResult;
  /** The Emitter's Modes the system reported for this line — any number. */
  intercepted_modes: { mode_id: string; mode_name: string }[];
  /** Reported as Default Unknown — no Mode matched. */
  intercepted_as_unknown: boolean;
  notes: string | null;
  /** Intercepted parameters — zero or more sets. */
  observed_values: ObservedValues[] | null;
}

/** A signal intercepted during an Intercept Test that isn't tied to a Mode. */
export interface TestRecordSignal {
  observed_values: ObservedValues[];
  /** Reported as Default Unknown; false = not reported at all. */
  reported_as_unknown: boolean;
  notes: string | null;
}

export interface TestRecord {
  id: string;
  scope_type: "emitter" | "mdf";
  scope_id: string;
  emitter_version_id: string | null;
  mdf_version_id: string | null;
  test_type: TestType;
  result: TestResult;
  /** Set when the result was overridden: what it worked out to, and why. */
  computed_result: TestResult | null;
  result_note: string | null;
  title: string;
  notes: string | null;
  tested_by: string | null;
  test_date: string;
  /** When on test_date it ran ("HH:MM:SS"); null on runs logged before times were kept. */
  test_time: string | null;
  simulation_created_date: string | null;
  /** "Manual", or a value written in; null on runs logged before dwell existed. */
  dwell: string | null;
  created_at: string;
  retests_test_record_id: string | null;
  modes: TestRecordModeLink[];
  lines: TestRecordLineResult[];
  signals: TestRecordSignal[];
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
  intercepted_as_unknown?: boolean;
  notes?: string;
  observed_values?: ObservedValues[];
}

export interface TestRecordInput {
  test_type: TestType;
  title: string;
  notes?: string;
  test_date: string;
  /** "HH:MM". */
  test_time?: string;
  simulation_created_date?: string;
  /** "Manual", or a value written in (e.g. "50 ms"). */
  dwell?: string;
  /** Per-Test-Line intercept-correctness outcome — when given, this is what the
   * whole-test result derives from (see backend precedence). */
  line_results?: TestRecordLineResultInput[];
  /** Per-Mode outcome — the whole-test result is derived from these only when
   * line_results is empty. */
  mode_results?: TestRecordModeResultInput[];
  /** Intercept Tests only: signals not tied to a Mode (they don't count towards the result). */
  signals?: { observed_values: ObservedValues[]; reported_as_unknown: boolean; notes?: string }[];
  /** Only used (and required) when neither line_results nor mode_results is given. */
  result?: TestResult;
  /** Optional pointer to an earlier test record this one re-runs. */
  retests_test_record_id?: string;
  /** The run in progress this was filled in as — deleted once logged. */
  draft_id?: string;
  /** The tester's call over the worked-out result, with why (required). */
  result_override?: TestResult;
  result_override_note?: string;
}

/** A test run being filled in, saved as it's typed. */
export interface TestRunDraft {
  id: string;
  emitter_id: string;
  title: string;
  test_type: TestType;
  summary: string | null;
  version: number;
  created_at: string;
  updated_at: string;
  created_by_username: string | null;
  updated_by_username: string | null;
}

export interface TestRunDraftFull<S = unknown> extends TestRunDraft {
  state: S;
}

export interface TestRunDraftSave<S = unknown> {
  title: string;
  test_type: TestType;
  summary: string;
  state: S;
  version?: number;
}

export const testDraftsApi = {
  list: (emitterId: string) => api.get<TestRunDraft[]>(`/emitters/${emitterId}/test-drafts`),
  get: <S>(id: string) => api.get<TestRunDraftFull<S>>(`/test-drafts/${id}`),
  create: <S>(emitterId: string, body: TestRunDraftSave<S>) =>
    api.post<TestRunDraftFull<S>>(`/emitters/${emitterId}/test-drafts`, body),
  save: <S>(id: string, body: TestRunDraftSave<S>) => api.put<TestRunDraft>(`/test-drafts/${id}`, body),
  discard: (id: string) => api.delete<void>(`/test-drafts/${id}`),
};

export const testRecordsApi = {
  listForEmitter: (emitterId: string) => api.get<TestRecord[]>(`/emitters/${emitterId}/test-records`),
  createForEmitter: (emitterId: string, input: TestRecordInput) =>
    api.post<TestRecord>(`/emitters/${emitterId}/test-records`, input),
  changeResultForEmitter: (emitterId: string, id: string, result: TestResult, note?: string) =>
    api.patch<TestRecord>(`/emitters/${emitterId}/test-records/${id}/result`, { result, note }),
  deleteForEmitter: (emitterId: string, id: string) =>
    api.delete<void>(`/emitters/${emitterId}/test-records/${id}`),

  listForMdf: (mdfId: string) => api.get<TestRecord[]>(`/mdfs/${mdfId}/test-records`),
  createForMdf: (mdfId: string, input: TestRecordInput) => api.post<TestRecord>(`/mdfs/${mdfId}/test-records`, input),
  deleteForMdf: (mdfId: string, id: string) => api.delete<void>(`/mdfs/${mdfId}/test-records/${id}`),
};
