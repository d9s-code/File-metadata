import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { platformNotesApi } from "../../api/platformNotes";

export function platformNotesKey(platformId: string) {
  return ["platform-notes", platformId] as const;
}

export function usePlatformNotes(platformId: string) {
  return useQuery({ queryKey: platformNotesKey(platformId), queryFn: () => platformNotesApi.list(platformId) });
}

export function useCreatePlatformNote(platformId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: string) => platformNotesApi.create(platformId, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: platformNotesKey(platformId) }),
  });
}

export function useDeletePlatformNote(platformId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (noteId: string) => platformNotesApi.delete(platformId, noteId),
    onSuccess: () => qc.invalidateQueries({ queryKey: platformNotesKey(platformId) }),
  });
}
