import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { mdfNotesApi } from "../../api/mdfNotes";

export function mdfNotesKey(mdfId: string) {
  return ["mdf-notes", mdfId] as const;
}

export function useMdfNotes(mdfId: string) {
  return useQuery({ queryKey: mdfNotesKey(mdfId), queryFn: () => mdfNotesApi.list(mdfId) });
}

export function useCreateMdfNote(mdfId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: string) => mdfNotesApi.create(mdfId, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: mdfNotesKey(mdfId) }),
  });
}

export function useDeleteMdfNote(mdfId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (noteId: string) => mdfNotesApi.delete(mdfId, noteId),
    onSuccess: () => qc.invalidateQueries({ queryKey: mdfNotesKey(mdfId) }),
  });
}
