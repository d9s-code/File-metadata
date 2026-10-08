import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { testDraftsApi, testRecordsApi, type TestRecordInput } from "../../api/testRecords";
import type { TestResult } from "../../types/domain";
import { mdfReadinessKey } from "./useMdfs";
import { testLinesKey } from "./useTestLines";
import { emitterModesKey } from "./useModes";
import { emittersKey } from "./useEmitters";

// A logged or deleted run changes each SIM line's status, each Mode's
// last-tested result, and the Emitter's "last validated" headline.
function invalidateEmitterTestState(qc: ReturnType<typeof useQueryClient>, emitterId: string) {
  qc.invalidateQueries({ queryKey: testRecordsKey("emitter", emitterId) });
  qc.invalidateQueries({ queryKey: testLinesKey(emitterId) });
  qc.invalidateQueries({ queryKey: emitterModesKey(emitterId) });
  qc.invalidateQueries({ queryKey: emittersKey });
  qc.invalidateQueries({ queryKey: testDraftsKey(emitterId) });
}

export function testDraftsKey(emitterId: string) {
  return ["testDrafts", emitterId] as const;
}

/** Test runs in progress on an Emitter. */
export function useEmitterTestDrafts(emitterId: string) {
  return useQuery({ queryKey: testDraftsKey(emitterId), queryFn: () => testDraftsApi.list(emitterId), enabled: !!emitterId });
}

export function useDiscardTestDraft(emitterId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => testDraftsApi.discard(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: testDraftsKey(emitterId) }),
  });
}

export function testRecordsKey(scope: "emitter" | "mdf", id: string) {
  return ["testRecords", scope, id] as const;
}

export function useEmitterTestRecords(emitterId: string) {
  return useQuery({
    queryKey: testRecordsKey("emitter", emitterId),
    queryFn: () => testRecordsApi.listForEmitter(emitterId),
    enabled: !!emitterId,
  });
}

export function useCreateEmitterTestRecord(emitterId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: TestRecordInput) => testRecordsApi.createForEmitter(emitterId, input),
    onSuccess: () => invalidateEmitterTestState(qc, emitterId),
  });
}

/** Override a logged run's result (with why), or set it back. */
export function useChangeTestResult(emitterId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, result, note }: { id: string; result: TestResult; note?: string }) =>
      testRecordsApi.changeResultForEmitter(emitterId, id, result, note),
    onSuccess: () => invalidateEmitterTestState(qc, emitterId),
  });
}

export function useDeleteEmitterTestRecord(emitterId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => testRecordsApi.deleteForEmitter(emitterId, id),
    onSuccess: () => invalidateEmitterTestState(qc, emitterId),
  });
}

export function useMdfTestRecords(mdfId: string) {
  return useQuery({
    queryKey: testRecordsKey("mdf", mdfId),
    queryFn: () => testRecordsApi.listForMdf(mdfId),
    enabled: !!mdfId,
  });
}

export function useCreateMdfTestRecord(mdfId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: TestRecordInput) => testRecordsApi.createForMdf(mdfId, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: testRecordsKey("mdf", mdfId) });
      qc.invalidateQueries({ queryKey: mdfReadinessKey(mdfId) });
    },
  });
}

export function useDeleteMdfTestRecord(mdfId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => testRecordsApi.deleteForMdf(mdfId, id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: testRecordsKey("mdf", mdfId) });
      qc.invalidateQueries({ queryKey: mdfReadinessKey(mdfId) });
    },
  });
}
