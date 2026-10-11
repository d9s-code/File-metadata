import { api } from "./client";
import type { TestResult } from "../types/domain";

export interface TestLine {
  id: string;
  emitter_id: string;
  label: string;
  expected_mode_id: string | null;
  expected_mode_name: string | null;
  /** Entirely optional, free-form — whatever the source table happened to carry. */
  expected_parameters: Record<string, unknown> | null;
  import_batch_label: string | null;
  /** When the SIM lines were created in the simulator (typed in at import). Null on older lines. */
  created_date: string | null;
  /** Status: this line's outcome in the most recent test run that included it. */
  last_test_result: TestResult | null;
  last_tested_at: string | null;
  last_test_record_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface TestLineCreateInput {
  label: string;
  expected_mode_id?: string;
  expected_parameters?: Record<string, unknown>;
}

export interface TestLineImportInput {
  lines: TestLineCreateInput[];
  batch_label?: string;
  created_date: string;
}

/** A revised SIM table, matched to the existing lines by label. */
export interface TestLineSyncInput {
  lines: TestLineCreateInput[];
  created_date: string;
  batch_label?: string;
  /** Delete the lines not in the table (and their results in logged runs). */
  remove_missing?: boolean;
  /** False: only work out what would change. */
  apply?: boolean;
}

export interface TestLineSyncResult {
  added: string[];
  updated: { id: string; label: string; changes: string[] }[];
  unchanged: string[];
  missing: { id: string; label: string; results: number }[];
  removed: boolean;
  applied: boolean;
}

export interface TestLineUpdateInput {
  label?: string;
  expected_mode_id?: string | null;
  expected_parameters?: Record<string, unknown> | null;
  created_date?: string;
}

export const testLinesApi = {
  listForEmitter: (emitterId: string) => api.get<TestLine[]>(`/emitters/${emitterId}/test-lines`),
  import: (emitterId: string, input: TestLineImportInput) =>
    api.post<TestLine[]>(`/emitters/${emitterId}/test-lines/import`, input),
  sync: (emitterId: string, input: TestLineSyncInput) =>
    api.post<TestLineSyncResult>(`/emitters/${emitterId}/test-lines/sync`, input),
  update: (emitterId: string, id: string, input: TestLineUpdateInput) =>
    api.patch<TestLine>(`/emitters/${emitterId}/test-lines/${id}`, input),
  delete: (emitterId: string, id: string) => api.delete<void>(`/emitters/${emitterId}/test-lines/${id}`),
};
