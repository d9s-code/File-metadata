import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { emitterNotesApi } from "../../api/emitterNotes";

export function emitterNotesKey(emitterId: string) {
  return ["emitter-notes", emitterId] as const;
}

export function useEmitterNotes(emitterId: string) {
  return useQuery({ queryKey: emitterNotesKey(emitterId), queryFn: () => emitterNotesApi.list(emitterId) });
}

export function useCreateEmitterNote(emitterId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: string) => emitterNotesApi.create(emitterId, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: emitterNotesKey(emitterId) }),
  });
}

export function useDeleteEmitterNote(emitterId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (noteId: string) => emitterNotesApi.delete(emitterId, noteId),
    onSuccess: () => qc.invalidateQueries({ queryKey: emitterNotesKey(emitterId) }),
  });
}
