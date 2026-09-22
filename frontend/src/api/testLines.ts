import { api } from "./client";

export interface TestLine {
  id: string;
  emitter_id: string;
  label: string;
  expected_mode_id: string | null;
  expected_mode_name: string | null;
  /** Entirely optional, free-form — whatever the source table happened to carry. */
  expected_parameters: Record<string, unknown> | null;
  import_batch_label: string | null;
  created_at: string;
}

export interface TestLineCreateInput {
  label: string;
  expected_mode_id?: string;
  expected_parameters?: Record<string, unknown>;
}

export interface TestLineImportInput {
  lines: TestLineCreateInput[];
  batch_label?: string;
}

export const testLinesApi = {
  listForEmitter: (emitterId: string) => api.get<TestLine[]>(`/emitters/${emitterId}/test-lines`),
  import: (emitterId: string, input: TestLineImportInput) =>
    api.post<TestLine[]>(`/emitters/${emitterId}/test-lines/import`, input),
  delete: (emitterId: string, id: string) => api.delete<void>(`/emitters/${emitterId}/test-lines/${id}`),
};
