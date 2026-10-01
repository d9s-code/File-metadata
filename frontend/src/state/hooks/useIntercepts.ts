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

/** Every entry of every Intercept on one Emitter — for the Emitter's
 * Intercepts tab. Shares the "intercept-entries" prefix, so any entry
 * change refreshes it too. */
export function useEmitterInterceptEntries(emitterId: string) {
  return useQuery({
    queryKey: ["intercept-entries", "emitter", emitterId],
    queryFn: () => interceptsApi.listEmitterEntries(emitterId),
    enabled: !!emitterId,
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
      qc.invalidateQueries({ queryKey: ["intercept-entries"] });
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
      qc.invalidateQueries({ queryKey: ["intercept-entries"] });
      qc.invalidateQueries({ queryKey: interceptKey(interceptId) });
      qc.invalidateQueries({ queryKey: ["intercepts"] });
    },
  });
}

export function useReplaceInterceptEntry(interceptId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ entryId, input }: { entryId: string; input: InterceptEntryInput }) =>
      interceptsApi.replaceEntry(interceptId, entryId, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["intercept-entries"] });
      // A Mode created from this entry shows its values as provenance.
      qc.invalidateQueries({ queryKey: ["modes"] });
    },
  });
}

/** The CSV import's save: into a new Intercept, or added to an existing one. */
export function useImportInterceptEntries() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (
      args:
        | { target: "new"; intercept: InterceptInput; entries: InterceptEntryInput[] }
        | { target: "existing"; interceptId: string; entries: InterceptEntryInput[] },
    ) => {
      if (args.target === "new") return interceptsApi.importNew(args.intercept, args.entries);
      await interceptsApi.bulkCreateEntries(args.interceptId, args.entries);
      return interceptsApi.get(args.interceptId);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["intercepts"] });
      qc.invalidateQueries({ queryKey: ["intercept"] });
      qc.invalidateQueries({ queryKey: ["intercept-entries"] });
    },
  });
}
