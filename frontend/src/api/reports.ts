import { api } from "./client";

/** One difference the import check found. `code` says what kind: a value
 * that differs, a row or column only one report has, a missing sheet. */
export interface ReportDifference {
  sheet: string;
  key: string;
  column: string;
  app: string;
  other: string;
  kind: string;
  code: "value" | "only_app" | "only_other" | "column_only_app" | "column_only_other" | "sheet_missing";
}

export interface ReportComparison {
  mdf_version: number;
  file_name: string | null;
  agrees: boolean;
  /** Per sheet, the rows each report had (the Unknown ones left out unless included). */
  rows: Record<string, { app: number; other: number }>;
  difference_count: number;
  /** The first 2000 of them. */
  differences: ReportDifference[];
}

export const reportsApi = {
  /** The Emitter report for the Platforms and Emitters picked, as an .xlsx file. */
  emitters: (input: { platform_ids: string[]; emitter_ids: string[] }) =>
    api.post<Blob>("/reports/emitters", input, { responseType: "blob" }),
  /** The analysis sheet for the same picks: Modes with Sources and notes, values as typed and with their delta. */
  analysis: (input: { platform_ids: string[]; emitter_ids: string[] }) =>
    api.post<Blob>("/reports/analysis", input, { responseType: "blob" }),
  /** The Emitter report for a saved MDF version (the latest unless given). */
  mdf: (mdfId: string, version?: number) =>
    api.get<Blob>(`/reports/mdfs/${mdfId}${version != null ? `?version=${version}` : ""}`, { responseType: "blob" }),
  /** The import check: the other app's report compared with this MDF's report of a saved version. */
  compareMdf: (mdfId: string, file: File, options: { version?: number; includeUnknown: boolean; strictText: boolean }) => {
    const form = new FormData();
    form.set("file", file);
    if (options.version != null) form.set("version", String(options.version));
    form.set("include_unknown", String(options.includeUnknown));
    form.set("strict_text", String(options.strictText));
    return api.post<ReportComparison>(`/reports/mdfs/${mdfId}/compare`, form);
  },
};

/** The weekly progress update's numbers: the 7 days up to `end` (GET /reports/weekly). */
export interface WeeklyUpdate {
  start: string;
  end: string;
  mdf: {
    name: string;
    status: string;
    customer: string | null;
    due_date: string | null;
    days_left: number | null;
    emitters: number;
    operational: number;
    operational_week_ago: number;
    by_status: { key: string; label: string; color: string; count: number }[];
    sim: { pass?: number; partial?: number; fail?: number; untested?: number };
    not_done: number;
    next_up: { name: string; reason: string; more: number; assignee: string | null }[];
    log: { date: string; kind: string; body: string; author: string | null }[];
  } | null;
  emitters: {
    status_moves: { emitter: string; from: string; to: string; to_key: string | null; date: string }[];
    to_operational: number;
    to_rework: number;
    modes: { added: number; changed: number; removed: number };
    emitters_touched: number;
    busiest: { emitter: string; added: number; changed: number; removed: number }[];
    versions: { emitter: string; version: number; date: string }[];
    needs_rework: number;
  };
  testing: {
    emitter_runs: number;
    emitter_results: Record<"pass" | "partial" | "fail" | "inconclusive", number>;
    platform_tests: number;
    platform_results: Record<"pass" | "partial" | "fail" | "inconclusive", number>;
    mdf_tests: number;
    mdf_results: Record<"pass" | "partial" | "fail" | "inconclusive", number>;
    mixups: number;
  };
  outlook: { open_tasks: number; overdue_tasks: number; unassigned_tasks: number };
}

export const weeklyApi = {
  get: (end: string) => api.get<WeeklyUpdate>(`/reports/weekly?end=${encodeURIComponent(end)}`),
};
