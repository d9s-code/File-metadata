import { api } from "./client";
import type { ObservedValues, TestRunDraft, TestRunDraftFull, TestRunDraftSave } from "./testRecords";
import type { LoggableTestType, TestResult } from "../types/domain";

/** One pinned Emitter's part of a Platform test, as logged. */
export interface PlatformTestEmitterInput {
  emitter_id: string;
  line_results?: {
    test_line_id: string;
    outcome: TestResult;
    intercepted_mode_ids?: string[];
    intercepted_as_unknown?: boolean;
    observed_values?: ObservedValues[];
    notes?: string;
  }[];
  mode_results?: { mode_id: string; result: TestResult; observed_values?: ObservedValues[]; notes?: string }[];
  signals?: { observed_values: ObservedValues[]; reported_as_unknown: boolean; notes?: string }[];
  result?: TestResult;
  result_override?: TestResult;
  result_override_note?: string;
  notes?: string;
  /** When this Emitter's simulation was built — or the run's when left out. */
  simulation_created_date?: string;
  /** When this redoes an earlier Platform test: the Emitter's record in it. */
  retests_test_record_id?: string;
}

export interface PlatformTestInput {
  test_type: LoggableTestType;
  title: string;
  notes?: string;
  test_date: string;
  test_time?: string;
  simulation_created_date?: string;
  /** The run's Received Power, in dBFS. */
  received_power_dbfs: number;
  dwell?: string;
  /** A saved version of one of the Platform's Dwell Strategies. */
  dwell_strategy_version_id?: string;
  draft_id?: string;
  emitters: PlatformTestEmitterInput[];
}

export interface PlatformTestEmitter {
  test_record_id: string;
  emitter_id: string;
  emitter_name: string;
  designation: string | null;
  /** The Emitter version tested: the one the Platform pinned. */
  version_number: number | null;
  result: TestResult;
  computed_result: TestResult | null;
  lines: number;
  modes: number;
  signals: number;
  /** How many SIM Test Lines / Modes came out each way, by result. */
  line_counts: Partial<Record<TestResult, number>>;
  mode_counts: Partial<Record<TestResult, number>>;
  /** The Emitter's own notes in the run (not the session notes). */
  notes: string | null;
  /** When its simulation was built (an Intercept Test: the intercept date). */
  simulation_created_date: string | null;
}

export interface PlatformTest {
  id: string;
  platform_id: string;
  platform_version_number: number | null;
  title: string;
  test_type: LoggableTestType;
  test_date: string;
  notes: string | null;
  /** The run's Received Power in dBFS; null on tests logged before it was asked. */
  received_power_dbfs: number | null;
  tested_by_username: string | null;
  created_at: string;
  /** The Dwell Strategy version the run used, if one was picked. */
  dwell_strategy_version_id?: string | null;
  dwell_strategy_id?: string | null;
  dwell_strategy_name?: string | null;
  dwell_strategy_version_number?: number | null;
  /** The worst of the Emitters' results. */
  result: TestResult;
  emitters: PlatformTestEmitter[];
}

export const platformTestsApi = {
  list: (platformId: string) => api.get<PlatformTest[]>(`/platforms/${platformId}/tests`),
  get: (id: string) => api.get<PlatformTest>(`/platform-tests/${id}`),
  create: (platformId: string, input: PlatformTestInput) => api.post<PlatformTest>(`/platforms/${platformId}/tests`, input),
  listDrafts: (platformId: string) => api.get<TestRunDraft[]>(`/platforms/${platformId}/test-drafts`),
  createDraft: <S>(platformId: string, body: TestRunDraftSave<S>) =>
    api.post<TestRunDraftFull<S>>(`/platforms/${platformId}/test-drafts`, body),
};
