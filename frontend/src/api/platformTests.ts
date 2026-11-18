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
  /** What was observed with the rest on the air; left out, nothing was recorded. */
  detected?: boolean;
  time_to_detect_s?: number;
  /** The dwell of the run's Strategy version that caught it: 1 for the first. */
  dwell_index?: number;
  reported_self?: boolean;
  reported_unknown?: boolean;
  reports?: ScenarioReportInput[];
}

/** A mix-up: reported as another Emitter, optionally Mode for Mode. */
export interface ScenarioReportInput {
  reported_emitter_id: string;
  reported_platform_id?: string;
  expected_mode?: string;
  reported_mode?: string;
}

export interface ScenarioReport {
  reported_emitter_id: string;
  reported_emitter_name: string;
  reported_platform_id: string | null;
  reported_platform_name: string | null;
  expected_mode: string | null;
  reported_mode: string | null;
}

/** One Emitter on the air in a Platform or MDF test, as observed. */
export interface ScenarioEmitter {
  emitter_id: string;
  emitter_name: string;
  platform_id: string | null;
  platform_name: string | null;
  detected: boolean | null;
  time_to_detect_s: number | null;
  dwell_index: number | null;
  dwell_label: string | null;
  reported_self: boolean | null;
  reported_unknown: boolean;
  result: TestResult | null;
  notes: string | null;
  reports: ScenarioReport[];
}

/** Detection, Identification and Mix-ups — each a result — and the counts behind them. */
export interface ScenarioVerdicts {
  detection: TestResult | null;
  identification: TestResult | null;
  mixups: TestResult | null;
  detected: number;
  observed: number;
  identified: number;
  mixup_count: number;
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
  /** Its frequency range in the version tested, deltas applied. */
  rf_min_mhz?: number | null;
  rf_max_mhz?: number | null;
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
  /** What was observed of it with the rest on the air (null on older runs). */
  observed?: ScenarioEmitter | null;
}

export interface PlatformTest {
  id: string;
  platform_id: string;
  platform_version_number: number | null;
  platform_version_label?: string | null;
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
  /** Detection, Identification and Mix-ups — when the run recorded what was observed. */
  verdicts?: ScenarioVerdicts | null;
}

export const platformTestsApi = {
  list: (platformId: string) => api.get<PlatformTest[]>(`/platforms/${platformId}/tests`),
  get: (id: string) => api.get<PlatformTest>(`/platform-tests/${id}`),
  create: (platformId: string, input: PlatformTestInput) => api.post<PlatformTest>(`/platforms/${platformId}/tests`, input),
  listDrafts: (platformId: string) => api.get<TestRunDraft[]>(`/platforms/${platformId}/test-drafts`),
  createDraft: <S>(platformId: string, body: TestRunDraftSave<S>) =>
    api.post<TestRunDraftFull<S>>(`/platforms/${platformId}/test-drafts`, body),
};
