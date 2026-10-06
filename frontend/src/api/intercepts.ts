import { api } from "./client";
import type { Intercept, InterceptEntry, InterceptEntryFields, InterceptReport, PriType } from "../types/domain";

export interface InterceptInput {
  emitter_id: string;
  name: string;
  description?: string | null;
  intercepted_on?: string | null;
  collected_by?: string | null;
}

export interface InterceptUpdateInput {
  name?: string;
  description?: string | null;
  intercepted_on?: string | null;
  collected_by?: string | null;
}

export interface InterceptEntryInput extends InterceptEntryFields {
  pri_type: PriType;
}

export interface MatchCountsOut {
  match: number;
  near: number;
  none: number;
}

export interface InterceptMatchCounts {
  total: MatchCountsOut;
  by_intercept: Record<string, MatchCountsOut>;
}

/** An Intercept already holding entries imported from a file. */
export interface SourceFileImport {
  intercept_id: string;
  intercept_name: string;
  emitter_id: string;
  entry_count: number;
  imported_at: string;
}

/** One report as sent with an import — a row rather than an object, since a
 * file holds tens of thousands: (file_line, mission_time, track, mode_track,
 * power, designation, mode_name, ambiguity_count, pri_type, rf_mhz, pri_us,
 * pw_us, jitter_us, stagger_us, entry index or null). */
export type ReportRow = [
  number,
  string | null,
  string | null,
  string | null,
  number | null,
  string | null,
  string | null,
  number | null,
  PriType,
  number,
  number | null,
  number | null,
  number | null,
  number[] | null,
  number | null,
];

export interface ReportsUpload {
  source_file: string | null;
  rows: ReportRow[];
}

export interface InterceptReportPage {
  total: number;
  items: InterceptReport[];
}

export type ReportSort = "line" | "time" | "rf" | "pri" | "pw" | "track" | "power";

/** Every report of an Intercept, compactly — for regrouping. Each report row
 * is [id, entry index (into entries) or null, ...fields]. */
export interface AllReports {
  grouping_version: number;
  entries: string[];
  fields: string[];
  reports: (string | number | null | number[])[][];
}

export interface RegroupGroup {
  entry: InterceptEntryInput;
  report_ids: string[];
}

export interface RegroupResult {
  unchanged: number;
  changed: number;
  created: number;
  removed: number;
  mode_links_moved: number;
  mode_links_dropped: number;
  reports_left_out: number;
  grouping_version: number;
}

/** Reports per import — matches the backend's MAX_IMPORT_REPORTS. */
export const MAX_IMPORT_REPORTS = 100_000;

/** Entries per import — matches the backend's MAX_IMPORT_ENTRIES. */
export const MAX_IMPORT_ENTRIES = 5000;

export const interceptsApi = {
  list: (params?: { emitterId?: string; search?: string }) => {
    const query = new URLSearchParams();
    if (params?.emitterId) query.set("emitter_id", params.emitterId);
    if (params?.search) query.set("search", params.search);
    const qs = query.toString();
    return api.get<Intercept[]>(`/intercepts${qs ? `?${qs}` : ""}`);
  },
  get: (interceptId: string) => api.get<Intercept>(`/intercepts/${interceptId}`),
  /** Make a Source that stands for this Intercept. */
  turnIntoSource: (interceptId: string) => api.post<Intercept>(`/intercepts/${interceptId}/source`),
  create: (input: InterceptInput) => api.post<Intercept>("/intercepts", input),
  /** A new Intercept, its entries and the reports they came from, in one transaction. */
  importNew: (intercept: InterceptInput, entries: InterceptEntryInput[], reports?: ReportsUpload) =>
    api.post<Intercept>("/intercepts/import", { intercept, entries, reports }),
  /** Entries and their reports added to an existing Intercept, all or nothing. */
  importInto: (interceptId: string, entries: InterceptEntryInput[], reports?: ReportsUpload) =>
    api.post<Intercept>(`/intercepts/${interceptId}/import`, { entries, reports }),
  listReports: (
    interceptId: string,
    params: { entryId?: string | "none"; sort?: ReportSort; direction?: "asc" | "desc"; offset?: number; limit?: number },
  ) => {
    const q = new URLSearchParams();
    if (params.entryId) q.set("entry_id", params.entryId);
    if (params.sort) q.set("sort", params.sort);
    if (params.direction) q.set("direction", params.direction);
    q.set("offset", String(params.offset ?? 0));
    q.set("limit", String(params.limit ?? 100));
    return api.get<InterceptReportPage>(`/intercepts/${interceptId}/reports?${q}`);
  },
  allReports: (interceptId: string) => api.get<AllReports>(`/intercepts/${interceptId}/reports/all`),
  /** Replaces how the reports are grouped into entries; dryRun only says what would change. */
  regroup: (interceptId: string, expectedVersion: number, groups: RegroupGroup[], dryRun = false) =>
    api.put<RegroupResult>(`/intercepts/${interceptId}/grouping?dry_run=${dryRun}`, {
      expected_version: expectedVersion,
      groups,
    }),
  /** Entries added to an existing Intercept, all or nothing. */
  bulkCreateEntries: (interceptId: string, entries: InterceptEntryInput[]) =>
    api.post<InterceptEntry[]>(`/intercepts/${interceptId}/entries/bulk`, entries),
  update: (interceptId: string, input: InterceptUpdateInput) =>
    api.patch<Intercept>(`/intercepts/${interceptId}`, input),
  delete: (interceptId: string) => api.delete<void>(`/intercepts/${interceptId}`),
  listEntries: (interceptId: string) => api.get<InterceptEntry[]>(`/intercepts/${interceptId}/entries`),
  /** Every entry of every Intercept on one Emitter. */
  listEmitterEntries: (emitterId: string) =>
    api.get<InterceptEntry[]>(`/intercepts/entries?emitter_id=${encodeURIComponent(emitterId)}`),
  /** Replaces an entry in place (same id, so a Mode created from it stays linked). */
  replaceEntry: (interceptId: string, entryId: string, input: InterceptEntryInput) =>
    api.put<InterceptEntry>(`/intercepts/${interceptId}/entries/${entryId}`, input),
  createEntry: (interceptId: string, input: InterceptEntryInput) =>
    api.post<InterceptEntry>(`/intercepts/${interceptId}/entries`, input),
  deleteEntry: (interceptId: string, entryId: string) =>
    api.delete<void>(`/intercepts/${interceptId}/entries/${entryId}`),
  /** Several entries at once, all or nothing. */
  deleteEntries: (interceptId: string, entryIds: string[]) =>
    api.post<void>(`/intercepts/${interceptId}/entries/delete`, { entry_ids: entryIds }),
  /** Entries that are one signal, merged into the first created of them. */
  mergeEntries: (interceptId: string, entryIds: string[]) =>
    api.post<InterceptEntry>(`/intercepts/${interceptId}/entries/merge`, { entry_ids: entryIds }),
  /** How an Emitter's Intercepts compare with its Modes — the counts only. */
  matchCounts: (emitterId: string) =>
    api.get<InterceptMatchCounts>(`/intercepts/match-counts?emitter_id=${encodeURIComponent(emitterId)}`),
  /** Intercepts already holding entries imported from a file of this name. */
  sourceFileImports: (name: string) =>
    api.get<SourceFileImport[]>(`/intercepts/source-files?name=${encodeURIComponent(name)}`),
};
