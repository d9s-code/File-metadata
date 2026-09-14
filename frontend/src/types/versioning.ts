export interface VersionSummary {
  id: string;
  version_number: number;
  change_summary: string | null;
  created_by: string | null;
  created_at: string;
}

export interface DiffEntry {
  path: string;
  value?: unknown;
  old_value?: unknown;
  new_value?: unknown;
}

export interface DiffResult {
  added: DiffEntry[];
  removed: DiffEntry[];
  changed: DiffEntry[];
  identical: boolean;
}
