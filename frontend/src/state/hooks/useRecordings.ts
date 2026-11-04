import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { recordingsApi, type Recording } from "../../api/recordings";
import type { RecordingFilters } from "../../components/recordings/recordingFilters";

const busy = (r: Recording) => r.status === "uploading" || r.status === "processing";

export function useRecordings() {
  return useQuery({
    queryKey: ["recordings"],
    queryFn: recordingsApi.list,
    // While one is being read, its count climbs — check back.
    refetchInterval: (q) => ((q.state.data ?? []).some((r) => r.status === "processing") ? 2000 : false),
  });
}

export function useRecording(id: string) {
  return useQuery({
    queryKey: ["recording", id],
    queryFn: () => recordingsApi.get(id),
    enabled: !!id,
    refetchInterval: (q) => (q.state.data && busy(q.state.data) ? 2000 : false),
  });
}

export function useRecordingOverview(id: string, filters: RecordingFilters, enabled: boolean) {
  return useQuery({
    queryKey: ["recording-overview", id, filters],
    queryFn: () => recordingsApi.overview(id, filters),
    enabled: !!id && enabled,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
}

export function useUpdateRecording(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { name?: string; description?: string | null }) => recordingsApi.update(id, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["recordings"] });
      qc.invalidateQueries({ queryKey: ["recording", id] });
      qc.invalidateQueries({ queryKey: ["intercepts"] });
      qc.invalidateQueries({ queryKey: ["intercept"] });
    },
  });
}

export function useDeleteRecording() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => recordingsApi.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["recordings"] });
      qc.invalidateQueries({ queryKey: ["intercepts"] });
      qc.invalidateQueries({ queryKey: ["intercept"] });
    },
  });
}
