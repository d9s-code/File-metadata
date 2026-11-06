import { api, API_BASE_URL } from "./client";

/** One change between two saved versions, or since the last one (see pinned_diff_service). */
export interface PinChange {
  scope: string;
  label: string;
  kind: "added" | "removed" | "changed";
  old_value: string | null;
  new_value: string | null;
}

/** What's changed in the pins since the latest saved version. */
export interface UnsavedPins {
  saved_version: number | null;
  entries: PinChange[];
}

export interface MdfGoal {
  id: string;
  text: string;
  position: number;
  done_at: string | null;
  done_note: string | null;
  done_by_username: string | null;
  created_at: string;
}

export type LogKind = "progress" | "release";

export interface MdfLogEntry {
  id: string;
  kind: LogKind;
  body: string;
  author_id: string | null;
  author_username: string | null;
  created_at: string;
}

/** One line of the change notes: a Platform, Emitter or dwell file, and
 * what it holds (added) or what changed in it (updated). */
export interface ChangeNote {
  kind: "Platform" | "Emitter" | "Dwell file";
  name: string;
  detail?: string | null;
  items?: string[];
}

export interface ChangeNotes {
  added: ChangeNote[];
  removed: ChangeNote[];
  updated: ChangeNote[];
}

export interface MdfSummary {
  mdf: { id: string; name: string; status: string; customer: string | null; due_date: string | null; release_date: string | null };
  from_version: number | null;
  from_at: string | null;
  to_version: number;
  to_at: string;
  versions: { version_number: number; at: string; by: string | null; change_summary: string | null; release_notes: string | null }[];
  /** Major changes only: what was added, removed and updated in what's delivered. */
  change_notes: ChangeNotes;
  contents: { platform: string; platform_version: number; emitters: { name: string; version: number }[] }[];
  last_release_version: number | null;
  /** Set when the changes count from the MDF this one follows. */
  from_mdf?: { id: string; name: string; version: number; at: string } | null;
  /** The MDF this one follows, if any. */
  previous_mdf?: { id: string; name: string; version: number } | null;
}

/** Where a summary counts from: a version of this MDF, its very start, or
 * the MDF it follows. */
export type SummaryFrom = number | "start" | "previous" | null;

function range(from?: SummaryFrom, to?: number | null) {
  const q = new URLSearchParams();
  if (from === "start" || from === "previous") q.set("base", from);
  else if (from) q.set("from_version", String(from));
  if (to) q.set("to_version", String(to));
  const s = q.toString();
  return s ? `?${s}` : "";
}

export const mdfPlanApi = {
  goals: (mdfId: string) => api.get<MdfGoal[]>(`/mdfs/${mdfId}/goals`),
  addGoal: (mdfId: string, text: string) => api.post<MdfGoal>(`/mdfs/${mdfId}/goals`, { text }),
  updateGoal: (mdfId: string, goalId: string, input: { text?: string; done?: boolean; note?: string | null }) =>
    api.patch<MdfGoal>(`/mdfs/${mdfId}/goals/${goalId}`, input),
  reorderGoals: (mdfId: string, ids: string[]) => api.put<MdfGoal[]>(`/mdfs/${mdfId}/goals/order`, { ids }),
  deleteGoal: (mdfId: string, goalId: string) => api.delete<void>(`/mdfs/${mdfId}/goals/${goalId}`),
  log: (mdfId: string) => api.get<MdfLogEntry[]>(`/mdfs/${mdfId}/log`),
  addLog: (mdfId: string, kind: LogKind, body: string) => api.post<MdfLogEntry>(`/mdfs/${mdfId}/log`, { kind, body }),
  deleteLog: (mdfId: string, entryId: string) => api.delete<void>(`/mdfs/${mdfId}/log/${entryId}`),
  setReleaseNotes: (mdfId: string, versionNumber: number, text: string | null) =>
    api.put<{ release_notes: string | null }>(`/mdfs/${mdfId}/versions/${versionNumber}/release-notes`, { text }),
  summary: (mdfId: string, from?: SummaryFrom, to?: number | null) =>
    api.get<MdfSummary>(`/mdfs/${mdfId}/summary${range(from, to)}`),
  summaryDocxUrl: (mdfId: string, from?: SummaryFrom, to?: number | null) =>
    `${API_BASE_URL}/mdfs/${mdfId}/summary.docx${range(from, to)}`,
  unsaved: (kind: "platform" | "mdf", id: string) =>
    api.get<UnsavedPins>(`/${kind === "mdf" ? "mdfs" : "platforms"}/${id}/unsaved`),
};
