import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  testLinesApi,
  type TestLine,
  type TestLineImportInput,
  type TestLineSyncInput,
  type TestLineUpdateInput,
} from "../../api/testLines";
import { compareLineLabels } from "../../components/testing/testFormat";

export function testLinesKey(emitterId: string) {
  return ["testLines", emitterId] as const;
}

export function useEmitterTestLines(emitterId: string) {
  return useQuery({
    queryKey: testLinesKey(emitterId),
    queryFn: () => testLinesApi.listForEmitter(emitterId),
    enabled: !!emitterId,
    select: sortLines,
  });
}

function sortLines(lines: TestLine[]): TestLine[] {
  return [...lines].sort((a, b) => compareLineLabels(a.label, b.label));
}

export function useImportTestLines(emitterId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: TestLineImportInput) => testLinesApi.import(emitterId, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: testLinesKey(emitterId) }),
  });
}

/** Previews (apply: false) or applies a revised SIM table. */
export function useSyncTestLines(emitterId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: TestLineSyncInput) => testLinesApi.sync(emitterId, input),
    onSuccess: (result) => {
      if (result.applied) qc.invalidateQueries({ queryKey: testLinesKey(emitterId) });
    },
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
