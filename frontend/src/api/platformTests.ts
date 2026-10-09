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
}

export interface PlatformTestInput {
  test_type: LoggableTestType;
  title: string;
  notes?: string;
  test_date: string;
  test_time?: string;
  simulation_created_date?: string;
  dwell?: string;
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
}

export interface PlatformTest {
  id: string;
  platform_id: string;
  platform_version_number: number | null;
  title: string;
  test_type: LoggableTestType;
  test_date: string;
  notes: string | null;
  tested_by_username: string | null;
  created_at: string;
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
