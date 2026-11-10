import { api } from "./client";

export interface PrsImportIssue {
  mode_name: string;
  error: string;
}

export interface PrsImportResult {
  source_id: string;
  ew_group_count: number;
  created_ew_group_names: string[];
  mode_count: number;
  created_mode_ids: string[];
}

export const prsImportApi = {
  import: (
    emitterId: string,
    file: File,
    target: { source_id: string } | { new_source_name: string; source_date?: string },
  ) => {
    const formData = new FormData();
    formData.append("file", file);
    if ("source_id" in target) {
      formData.append("source_id", target.source_id);
    } else {
      formData.append("new_source_name", target.new_source_name);
      if (target.source_date) formData.append("source_date", target.source_date);
    }
    return api.post<PrsImportResult>(`/emitters/${emitterId}/imports/prs-import`, formData);
  },
};

export interface PrsFileMode {
  index: number;
  name: string;
  ew_group_name: string;
  pri_type: string;
}

export interface PrsUpdatePair {
  mode_id: string;
  mode_name: string;
  ew_group_name: string;
  /** The Mode in the file it's updated from (an index into file_modes), or null: left as it is. */
  file_index: number | null;
  /** "name": matched by name; "picked": chosen by hand; "none". */
  match: "name" | "picked" | "none";
  changes: Record<string, { old: unknown; new: unknown }>;
  notes: string[];
  error: string | null;
}

export interface PrsUpdatePreview {
  file_emitter_name: string;
  file_modes: PrsFileMode[];
  issues: PrsImportIssue[];
  pairs: PrsUpdatePair[];
}

export interface PrsUpdateResult {
  updated: string[];
  unchanged: string[];
  skipped: string[];
}

function updateForm(file: File, modeIds: string[], pairs: Record<string, number | null> | null) {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("mode_ids", JSON.stringify(modeIds));
  if (pairs) formData.append("pairs", JSON.stringify(pairs));
  return formData;
}

export const prsUpdateApi = {
  /** What updating these Modes from the file would change — nothing is saved. */
  preview: (emitterId: string, file: File, modeIds: string[], pairs: Record<string, number | null> | null) =>
    api.post<PrsUpdatePreview>(`/emitters/${emitterId}/imports/prs-update/preview`, updateForm(file, modeIds, pairs)),
  update: (emitterId: string, file: File, modeIds: string[], pairs: Record<string, number | null>) =>
    api.post<PrsUpdateResult>(`/emitters/${emitterId}/imports/prs-update`, updateForm(file, modeIds, pairs)),
};
