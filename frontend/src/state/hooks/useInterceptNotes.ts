import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { interceptNotesApi } from "../../api/interceptNotes";

export function interceptNotesKey(interceptId: string) {
  return ["intercept-notes", interceptId] as const;
}

export function useInterceptNotes(interceptId: string) {
  return useQuery({
    queryKey: interceptNotesKey(interceptId),
    queryFn: () => interceptNotesApi.list(interceptId),
    enabled: !!interceptId,
  });
}

export function useCreateInterceptNote(interceptId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: string) => interceptNotesApi.create(interceptId, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: interceptNotesKey(interceptId) }),
  });
}

export function useDeleteInterceptNote(interceptId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (noteId: string) => interceptNotesApi.delete(interceptId, noteId),
    onSuccess: () => qc.invalidateQueries({ queryKey: interceptNotesKey(interceptId) }),
  });
}
