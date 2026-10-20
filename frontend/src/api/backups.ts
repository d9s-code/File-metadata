import { api, API_BASE_URL } from "./client";

export type BackupKind = "scheduled" | "manual" | "before-restore" | "unknown";

export interface BackupCounts {
  emitters: number;
  platforms: number;
  mdfs: number;
  /** Not on backups taken before dwells were listed. */
  dwell_strategies?: number;
  dwell_files?: number;
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
  /** The whole repository as PRS XML, taken with this backup; null for older backups. */
  prs_export: PrsExport | null;
}

export type PrsExport =
  | {
      file: string;
      size_bytes: number;
      sha256: string;
      emitters: number;
      platforms: number;
      mdfs: number;
      dwell_files?: number;
      dwell_strategies?: number;
      files: number;
      never_saved: number;
    }
  | { error: string };

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
  /** A kind the latest backup didn't list (taken before it was) is left out. */
  kinds: Partial<Record<BackupDiffKind, FreshnessKind>> | null;
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

export type BackupDiffKind = "emitters" | "platforms" | "mdfs" | "dwell_strategies" | "dwell_files";

/** What a backup lists and compares, in order, and where each item opens. */
export const BACKUP_KINDS: { key: BackupDiffKind; label: string; path: string }[] = [
  { key: "emitters", label: "Emitters", path: "/emitters" },
  { key: "platforms", label: "Platforms", path: "/platforms" },
  { key: "mdfs", label: "MDFs", path: "/mdfs" },
  { key: "dwell_strategies", label: "Dwell Strategies", path: "/dwells/strategies" },
  { key: "dwell_files", label: "Dwell files", path: "/dwells/files" },
];

export interface BackupKindChanges {
  added: { id: string; name: string; deleted?: boolean }[];
  removed: { id: string; name: string }[];
  changed: { id: string; name: string; changes: string[] }[];
  unchanged: number;
}

export interface BackupDiff {
  from: { name: string; label: string };
  to: { name: string; label: string };
  /** A kind either side didn't list (taken before it was) is left out. */
  changes: Partial<Record<BackupDiffKind, BackupKindChanges>>;
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
  downloadUrl: (file: string, part: "database" | "prs" = "database") =>
    `${API_BASE_URL}/admin/backups/${encodeURIComponent(file)}/download${part === "prs" ? "?part=prs" : ""}`,
  diff: (from: string, to: string) =>
    api.get<BackupDiff>(`/admin/backups/diff?${new URLSearchParams({ from, to }).toString()}`),
};
