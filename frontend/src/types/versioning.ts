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

// Emitter-specific diff shape: entries are already grouped by the actual
// Mode/EW Group/Source/Emitter they belong to, with a human field label
// (e.g. "RF Min (MHz)") instead of a raw nested-path string.
export interface EmitterDiffEntry {
  scope: string;
  label: string;
  kind: "changed" | "added" | "removed";
  old_value?: unknown;
  new_value?: unknown;
}

export interface EmitterDiffResult {
  entries: EmitterDiffEntry[];
  identical: boolean;
}
