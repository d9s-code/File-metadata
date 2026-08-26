import { api } from "./client";
import type { TestResult, TestType } from "../types/domain";

export interface TestRecordModeLink {
  mode_id: string;
  mode_name: string;
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
  created_at: string;
  modes: TestRecordModeLink[];
}

export interface TestRecordInput {
  test_type: TestType;
  result: TestResult;
  title: string;
  notes?: string;
  test_date: string;
  mode_ids?: string[];
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
