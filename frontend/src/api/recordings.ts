import { api } from "./client";
import type { PriType } from "../types/domain";
import { filtersToQuery, type FilterParam, type RecordingFilters } from "../components/recordings/recordingFilters";

export type RecordingStatus = "uploading" | "processing" | "ready" | "failed";

export interface Recording {
  id: string;
  name: string;
  size_bytes: number;
  status: RecordingStatus;
  error: string | null;
  report_count: number;
  skipped_count: number;
  /** "line N: why" for a few of the lines that couldn't be read. */
  skipped_sample: string[] | null;
  first_time: string | null;
  last_time: string | null;
  description: string | null;
  created_at: string;
  uploaded_by_username: string | null;
  /** The size of each part the file is sent in. */
  chunk_bytes: number;
  /** The Intercepts snipped from it. */
  intercepts: { id: string; name: string; emitter_id: string; entry_count: number; snip: Record<string, unknown> | null }[];
  /** False on the offline app, whose copy has the recording but not its reports. */
  reports_here: boolean;
  /** The same file had been uploaded before — this is that recording. */
  already_uploaded: boolean;
}

export interface DensityParam {
  min: number;
  max: number;
  bins: number;
  /** [time bin, value bin, count] for every cell holding any. */
  cells: [number, number, number][];
}

export interface RecordingOverview {
  total: number;
  without_time: number;
  /** Seconds since 1970 (UTC). */
  time: { min: number | null; max: number | null; bins: number };
  /** [time bin, count]. */
  counts?: [number, number][];
  params: Partial<Record<FilterParam, DensityParam | null>>;
  by_type: Partial<Record<PriType, number>>;
  identified: { label: string | null; count: number }[];
  max_snip: number;
}

export interface SnipReports {
  recording: string;
  fields: string[];
  reports: unknown[][];
}

export const recordingsApi = {
  list: () => api.get<Recording[]>("/recordings"),
  get: (id: string) => api.get<Recording>(`/recordings/${id}`),
  start: (input: { name: string; size_bytes: number; description?: string | null }) =>
    api.post<Recording>("/recordings", input),
  putChunk: (id: string, index: number, chunk: Blob) => api.put<void>(`/recordings/${id}/chunks/${index}`, chunk),
  complete: (id: string) => api.post<Recording>(`/recordings/${id}/complete`),
  update: (id: string, input: { name?: string; description?: string | null }) =>
    api.patch<Recording>(`/recordings/${id}`, input),
  delete: (id: string) => api.delete<void>(`/recordings/${id}`),
  overview: (id: string, f: RecordingFilters) => api.get<RecordingOverview>(`/recordings/${id}/overview${filtersToQuery(f)}`),
  reports: (id: string, f: RecordingFilters) => api.get<SnipReports>(`/recordings/${id}/reports${filtersToQuery(f)}`),
};

/** Sends a file in parts (each well under the proxy's request limit), then
 * asks the server to read it. A part that fails is tried again a few times. */
export async function uploadRecording(
  file: File,
  onProgress: (sentBytes: number) => void,
  signal?: AbortSignal,
): Promise<Recording> {
  const rec = await recordingsApi.start({ name: file.name, size_bytes: file.size });
  try {
    await sendParts(rec, file, onProgress, signal);
  } catch (err) {
    // Cancelled or failed part-way: nothing half-sent is left behind.
    await recordingsApi.delete(rec.id).catch(() => undefined);
    throw err;
  }
  return recordingsApi.complete(rec.id);
}

async function sendParts(rec: Recording, file: File, onProgress: (sentBytes: number) => void, signal?: AbortSignal) {
  const size = rec.chunk_bytes;
  const parts = Math.ceil(file.size / size);
  for (let i = 0; i < parts; i++) {
    if (signal?.aborted) throw new DOMException("Upload cancelled", "AbortError");
    const chunk = file.slice(i * size, Math.min(file.size, (i + 1) * size));
    for (let attempt = 1; ; attempt++) {
      try {
        await recordingsApi.putChunk(rec.id, i, chunk);
        break;
      } catch (err) {
        if (attempt >= 4 || signal?.aborted) throw err;
        await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      }
    }
    onProgress(Math.min(file.size, (i + 1) * size));
  }
}
