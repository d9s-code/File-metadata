import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { emittersApi, type EmitterCreateInput } from "../../api/emitters";

export const emittersKey = ["emitters"] as const;

export function useEmitters() {
  return useQuery({ queryKey: emittersKey, queryFn: () => emittersApi.list() });
}

export function useEmitter(id: string | undefined) {
  return useQuery({
    queryKey: [...emittersKey, id],
    queryFn: () => emittersApi.get(id as string),
    enabled: !!id,
  });
}

export function useCreateEmitter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: EmitterCreateInput) => emittersApi.create(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: emittersKey }),
  });
}

export function useDeleteEmitter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, hard }: { id: string; hard?: boolean }) => emittersApi.delete(id, hard),
    onSuccess: () => qc.invalidateQueries({ queryKey: emittersKey }),
  });
}

export function useUpdateEmitter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<any> }) => emittersApi.update(id, input),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: emittersKey });
      qc.invalidateQueries({ queryKey: [...emittersKey, variables.id] });
    },
  });
}

export function useRestoreEmitter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => emittersApi.restore(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: emittersKey }),
  });
}
