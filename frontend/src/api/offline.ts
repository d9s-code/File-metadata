import { api } from "./client";

/** Whether this is the standalone (offline) build of the app, running on one PC. */
export const STANDALONE = import.meta.env.VITE_STANDALONE === "true";

export interface OfflineStatus {
  standalone: boolean;
  set_up: boolean;
  server_url: string | null;
  fetched_at: string | null;
  fetched_by: string | null;
  synced_at: string | null;
  connected_as: string | null;
  device: string;
}

export interface LocalChanges {
  total: number;
  per_table: Record<string, number>;
  entries: { at: string; summary: string; action: string }[];
  fetched_at: string | null;
}

export interface SyncConflict {
  table: string;
  kind: "field" | "server_deleted" | "pc_deleted" | "parent_deleted";
  note: string;
  fields: { name: string; base: unknown; server: unknown; pc: unknown }[];
  /** "table|key" of a row keeping the PC's version would put back. */
  restore: string | null;
}

export interface SyncGroup {
  key: string;
  kind: string;
  label: string;
  changes: number;
  conflicts: SyncConflict[];
}

export interface SyncPreview {
  summary: Partial<Record<"insert" | "update" | "delete", number>>;
  notes: string[];
  unresolved: string[];
  groups: SyncGroup[];
  local_changes: number;
}

export interface SyncResult {
  applied: Partial<Record<"insert" | "update" | "delete", number>>;
  notes: string[];
  fetched_rows: number;
  kept_copy: string | null;
}

export interface ServerLogin {
  server_url: string;
  username: string;
  password: string;
}

export type Resolutions = Record<string, "server" | "pc">;

export const offlineApi = {
  status: () => api.get<OfflineStatus>("/offline/status"),
  setup: (login: ServerLogin) => api.post<{ rows: number }>("/offline/setup", login),
  loginViaServer: (login: { username: string; password: string }) =>
    api.post<{ remembered: string }>("/offline/login-via-server", login),
  connect: (login: ServerLogin) => api.post<{ connected_as: string }>("/offline/connect", login),
  disconnect: () => api.post<{ connected_as: null }>("/offline/disconnect"),
  changes: () => api.get<LocalChanges>("/offline/changes"),
  preview: (resolutions: Resolutions) => api.post<SyncPreview>("/offline/preview", { resolutions }),
  sync: (resolutions: Resolutions) => api.post<SyncResult>("/offline/sync", { resolutions }),
  fetch: (force: boolean) => api.post<{ rows: number; kept_copy: string | null }>(`/offline/fetch${force ? "?force=true" : ""}`),
};
