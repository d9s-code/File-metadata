import { api } from "./client";
import type { Emitter } from "../types/domain";

export interface EmitterCreateInput {
  name: string;
  designation?: string;
  description?: string;
  /** What kind of emitter it is — the Add Emitter form requires one. */
  function_code_id?: string;
}

export type EmitterBulkActionName = "assign" | "status" | "pin" | "release";

export interface EmitterBulkInput {
  emitter_ids: string[];
  action: EmitterBulkActionName;
  assignee_id?: string | null;
  new_status?: string;
  note?: string;
  /** status: move even where the new status's milestones aren't all met. */
  confirm_unmet?: boolean;
  platform_id?: string;
}

export interface EmitterBulkResult {
  done: number;
  skipped: number;
  results: { id: string; name: string; ok: boolean; message: string }[];
}

export const emittersApi = {
  bulk: (input: EmitterBulkInput) => api.post<EmitterBulkResult>("/emitters/bulk", input),
  list: (includeDeleted = false) =>
    api.get<Emitter[]>(`/emitters${includeDeleted ? "?include_deleted=true" : ""}`),
  get: (id: string) => api.get<Emitter>(`/emitters/${id}`),
  create: (input: EmitterCreateInput) => api.post<Emitter>("/emitters", input),
  update: (id: string, input: Partial<EmitterCreateInput>) => api.patch<Emitter>(`/emitters/${id}`, input),
  delete: (id: string, hard = false) => api.delete<void>(`/emitters/${id}${hard ? "?hard=true" : ""}`),
  restore: (id: string) => api.post<Emitter>(`/emitters/${id}/restore`),
  /** Every Emitter someone holds for editing, longest-held first. */
  checkouts: () => api.get<EmitterCheckout[]>("/emitters/checkouts"),
  checkout: (id: string) => api.post<Emitter>(`/emitters/${id}/checkout`),
  checkin: (id: string) => api.delete<Emitter>(`/emitters/${id}/checkout`),
  /** What kind of emitter it is — needs no edit lock. */
  setFunctionCode: (id: string, functionCodeId: string | null) =>
    api.put<Emitter>(`/emitters/${id}/function-code`, { function_code_id: functionCodeId }),
  discard: (id: string) => api.post<Emitter>(`/emitters/${id}/discard`),
  exportXml: (id: string, options?: any) => api.post<Blob>(`/emitters/${id}/export/xml`, undefined, options),
  /** Several Emitters in one XML archive. */
  exportXmlMany: (ids: string[]) =>
    api.post<Blob>("/emitters/export/xml", { emitter_ids: ids }, { responseType: "blob" }),
  // sourceDate (YYYY-MM-DD), if given, overrides the "Date last updated" the
  // importer would otherwise parse from the JSON file's own per-set
  // date_last_updated field — see transformer.py.
  importJson: (emitterId: string, file: File, sourceDate?: string, groupId?: string) => {
    const formData = new FormData();
    formData.append("file", file);
    if (sourceDate) formData.append("source_date", sourceDate);
    if (groupId) formData.append("group_id", groupId);
    return api.post<JsonImportResult>(`/emitters/${emitterId}/imports/json-import`, formData);
  },
  previewJson: (emitterId: string, file: File, sourceDate?: string) => {
    const formData = new FormData();
    formData.append("file", file);
    if (sourceDate) formData.append("source_date", sourceDate);
    return api.post<JsonImportPreview>(`/emitters/${emitterId}/imports/json-import/preview`, formData);
  },
};

/** What importing a JSON file would create — nothing is saved. */
export interface JsonImportPreview {
  document_name: string;
  document_reference: string | null;
  sets: {
    source_name: string;
    source_date: string;
    source_description: string | null;
    elements: { element_type: string; variant: string | null; label: string | null; value_min: number | null; value_max: number | null }[];
    sequences: { label: string | null; steps: number; parameters: string[]; guessed_kind: "stagger" | "dwell_switch" }[];
    /** A Source of this name is already on the Emitter. */
    name_taken: boolean;
  }[];
  element_count: number;
  sequence_count: number;
  skipped: string[];
  issues: { path: string; message: string; severity: "error" | "warning" }[];
  valid: boolean;
}

/** What a JSON import made, and what in the file couldn't be read and was left out. */
export interface JsonImportResult {
  source_count: number;
  element_count: number;
  sequence_count: number;
  skipped: string[];
}

export interface EmitterCheckout {
  emitter_id: string;
  emitter_name: string;
  checked_out_by_id: string;
  checked_out_by_username: string | null;
  checked_out_at: string | null;
  /** The holder's latest change to it since taking the lock (or when they took it). */
  last_activity_at?: string | null;
  /** Untouched long enough to be flagged (CHECKOUT_WARN_DAYS). */
  stale?: boolean;
  /** When it's released if still untouched (null: never). */
  releases_at?: string | null;
}
