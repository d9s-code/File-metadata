import { api, API_BASE_URL } from "./client";

export type BackupKind = "scheduled" | "manual" | "before-restore" | "unknown";

export interface BackupCounts {
  emitters: number;
  platforms: number;
  mdfs: number;
}

export interface BackupVerification {
  at: string;
  ok: boolean;
  message: string;
  tables?: number;
  rows?: number;
}

export interface BackupItem {
  file: string;
  created_at: string;
  kind: BackupKind;
  created_by: string | null;
  size_bytes: number;
  /** Null for a backup made before backups kept an overview. */
  summary: BackupCounts | null;
  has_overview: boolean;
  verification: BackupVerification | null;
  copied_to: string | null;
  sha256: string | null;
}

export interface SchedulerStatus {
  heartbeat_at?: string;
  next_run_at?: string | null;
  last_run_at?: string;
  finished_at?: string;
  last_error?: string | null;
  last_steps?: string[];
}

export type FreshnessLevel = "ok" | "due" | "overdue" | "none";

export interface FreshnessKind {
  added: number;
  removed: number;
  changed: number;
  /** The first few, added first. */
  named: { id: string; name: string; how: "added" | "changed" | "removed" }[];
}

/** Time since the latest backup, what's changed since, and whether one is due. */
export interface BackupFreshness {
  level: FreshnessLevel;
  latest_backup_at: string | null;
  age_hours: number | null;
  /** Audit Log entries that changed data since the latest backup. */
  changes: number | null;
  /** How long after the latest backup the next is due, given those changes. */
  due_after_hours: number | null;
  due_at: string | null;
  changes_per_week: number;
  kinds: Record<BackupDiffKind, FreshnessKind> | null;
  /** "Sundays at 03:00 UTC". */
  schedule: string;
  next_scheduled_at: string | null;
}

export interface BackupHealth {
  ok: boolean;
  problems: string[];
  latest_backup_at: string | null;
  last_verification: BackupVerification | null;
  scheduler: SchedulerStatus | null;
  copy_dir: string | null;
  schedule: string;
  freshness: BackupFreshness;
}

export interface BackupListing {
  health: BackupHealth;
  backups: BackupItem[];
  live: BackupCounts;
}

export type BackupDiffKind = "emitters" | "platforms" | "mdfs";

export interface BackupKindChanges {
  added: { id: string; name: string; deleted?: boolean }[];
  removed: { id: string; name: string }[];
  changed: { id: string; name: string; changes: string[] }[];
  unchanged: number;
}

export interface BackupDiff {
  from: { name: string; label: string };
  to: { name: string; label: string };
  changes: Record<BackupDiffKind, BackupKindChanges>;
}

/** Compare against the current data instead of a second backup. */
export const LIVE_DATA = "live";

export const backupsApi = {
  /** For anyone signed in — the dashboard's Backup card. */
  status: () => api.get<BackupFreshness>("/backup-status"),
  list: () => api.get<BackupListing>("/admin/backups"),
  health: () => api.get<BackupHealth>("/admin/backups/health"),
  backUpNow: () => api.post<BackupItem>("/admin/backups"),
  verify: (file: string) => api.post<BackupItem>(`/admin/backups/${encodeURIComponent(file)}/verify`),
  /** A plain link, so the browser streams the file into its own downloads. */
  downloadUrl: (file: string) => `${API_BASE_URL}/admin/backups/${encodeURIComponent(file)}/download`,
  diff: (from: string, to: string) =>
    api.get<BackupDiff>(`/admin/backups/diff?${new URLSearchParams({ from, to }).toString()}`),
};
