import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { testRecordsApi, type TestRecordInput } from "../../api/testRecords";
import { mdfReadinessKey } from "./useMdfs";

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
    onSuccess: () => qc.invalidateQueries({ queryKey: testRecordsKey("emitter", emitterId) }),
  });
}

export function useDeleteEmitterTestRecord(emitterId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => testRecordsApi.deleteForEmitter(emitterId, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: testRecordsKey("emitter", emitterId) }),
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
