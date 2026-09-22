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
