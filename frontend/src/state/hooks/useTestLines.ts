import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { testLinesApi, type TestLineImportInput, type TestLineUpdateInput } from "../../api/testLines";

export function testLinesKey(emitterId: string) {
  return ["testLines", emitterId] as const;
}

export function useEmitterTestLines(emitterId: string) {
  return useQuery({
    queryKey: testLinesKey(emitterId),
    queryFn: () => testLinesApi.listForEmitter(emitterId),
    enabled: !!emitterId,
  });
}

export function useImportTestLines(emitterId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: TestLineImportInput) => testLinesApi.import(emitterId, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: testLinesKey(emitterId) }),
  });
}

export function useUpdateTestLine(emitterId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: TestLineUpdateInput }) => testLinesApi.update(emitterId, id, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: testLinesKey(emitterId) }),
  });
}

export function useDeleteTestLine(emitterId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => testLinesApi.delete(emitterId, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: testLinesKey(emitterId) }),
  });
}
