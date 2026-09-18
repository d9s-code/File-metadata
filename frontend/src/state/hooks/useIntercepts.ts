import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  interceptsApi,
  type InterceptEntryInput,
  type InterceptInput,
  type InterceptUpdateInput,
} from "../../api/intercepts";

export function interceptsKey(params?: { emitterId?: string; search?: string }) {
  return ["intercepts", params?.emitterId ?? null, params?.search ?? null] as const;
}

export function interceptKey(interceptId: string) {
  return ["intercept", interceptId] as const;
}

export function interceptEntriesKey(interceptId: string) {
  return ["intercept-entries", interceptId] as const;
}

export function useIntercepts(params?: { emitterId?: string; search?: string }) {
  return useQuery({
    queryKey: interceptsKey(params),
    queryFn: () => interceptsApi.list(params),
  });
}

export function useIntercept(interceptId: string) {
  return useQuery({
    queryKey: interceptKey(interceptId),
    queryFn: () => interceptsApi.get(interceptId),
    enabled: !!interceptId,
  });
}

export function useCreateIntercept() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: InterceptInput) => interceptsApi.create(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["intercepts"] }),
  });
}

export function useUpdateIntercept() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ interceptId, input }: { interceptId: string; input: InterceptUpdateInput }) =>
      interceptsApi.update(interceptId, input),
    onSuccess: (_, variables) => {
      qc.invalidateQueries({ queryKey: ["intercepts"] });
      qc.invalidateQueries({ queryKey: interceptKey(variables.interceptId) });
    },
  });
}

export function useDeleteIntercept() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (interceptId: string) => interceptsApi.delete(interceptId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["intercepts"] }),
  });
}

export function useInterceptEntries(interceptId: string) {
  return useQuery({
    queryKey: interceptEntriesKey(interceptId),
    queryFn: () => interceptsApi.listEntries(interceptId),
    enabled: !!interceptId,
  });
}

export function useCreateInterceptEntry(interceptId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: InterceptEntryInput) => interceptsApi.createEntry(interceptId, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: interceptEntriesKey(interceptId) });
      qc.invalidateQueries({ queryKey: interceptKey(interceptId) });
      qc.invalidateQueries({ queryKey: ["intercepts"] });
    },
  });
}

export function useDeleteInterceptEntry(interceptId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (entryId: string) => interceptsApi.deleteEntry(interceptId, entryId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: interceptEntriesKey(interceptId) });
      qc.invalidateQueries({ queryKey: interceptKey(interceptId) });
      qc.invalidateQueries({ queryKey: ["intercepts"] });
    },
  });
}
