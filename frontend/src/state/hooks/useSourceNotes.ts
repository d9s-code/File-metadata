import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { sourceNotesApi } from "../../api/sourceNotes";

export function sourceNotesKey(emitterId: string, sourceId: string) {
  return ["source-notes", emitterId, sourceId] as const;
}

export function useSourceNotes(emitterId: string, sourceId: string) {
  return useQuery({
    queryKey: sourceNotesKey(emitterId, sourceId),
    queryFn: () => sourceNotesApi.list(emitterId, sourceId),
  });
}

export function useCreateSourceNote(emitterId: string, sourceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: string) => sourceNotesApi.create(emitterId, sourceId, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: sourceNotesKey(emitterId, sourceId) }),
  });
}

export function useDeleteSourceNote(emitterId: string, sourceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (noteId: string) => sourceNotesApi.delete(emitterId, sourceId, noteId),
    onSuccess: () => qc.invalidateQueries({ queryKey: sourceNotesKey(emitterId, sourceId) }),
  });
}
