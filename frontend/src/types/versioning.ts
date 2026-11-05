export interface VersionSummary {
  id: string;
  version_number: number;
  /** Platforms: "3", or "3.1" for a minor version (an Emitter repinned in v3). */
  version_label?: string;
  change_summary: string | null;
  created_by: string | null;
  /** Who saved it, by name. */
  created_by_username?: string | null;
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
  /** The same changes, readable — pins added, removed or moved, and fields. */
  entries?: EmitterDiffEntry[];
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

/** "v3" — or a Platform version's label, "v3.1". */
export function versionName(v: { version_number: number; version_label?: string } | undefined | null): string {
  return v ? `v${v.version_label ?? v.version_number}` : "v?";
}
