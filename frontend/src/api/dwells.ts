import { api } from "./client";
import type { EmitterDiffResult, VersionSummary } from "../types/versioning";

/** One dwell: where the receiver sits (MHz) and for how long (ms), as in the file. */
export interface Dwell {
  freq_mhz: number;
  dwell_time_ms: number;
  collect_time_ms: number;
}

/** A dwell file a Strategy is in, and which of its versions. */
export interface StrategyUse {
  link_id: string;
  file_id: string;
  file_name: string;
  pinned_version_number: number;
  outdated: boolean;
}

/** A test run that recorded a version of the Strategy. */
export interface StrategyTestUse {
  kind: "emitter" | "mdf" | "platform";
  id: string;
  owner_id: string;
  title: string;
  test_date: string;
  version_number: number;
}

export interface DwellStrategySummary {
  id: string;
  name: string;
  /** The Platforms it covers, in order; none: a default dwell. */
  platform_ids: string[];
  platform_names: string[];
  is_default: boolean;
  description: string | null;
  dwell_count: number;
  cycle_ms: number;
  lowest_mhz: number | null;
  highest_mhz: number | null;
  latest_version_number: number | null;
  latest_version_id: string | null;
  /** Changed since its latest saved version. */
  unsaved: boolean;
  /** The dwell files it's in, by name. */
  used_in: string[];
  updated_at: string;
}

export interface DwellStrategy {
  id: string;
  name: string;
  /** The Platforms it covers, in order; none: a default dwell. */
  platform_ids: string[];
  platform_names: string[];
  is_default: boolean;
  description: string | null;
  manual_collect_time_ms: number;
  dwells: Dwell[];
  /** Kept as the file had them — not edited in the app. */
  rapid_df: Record<string, string> | null;
  split_mode: { collect_time: string; dwell_time: string; freqs: string[] }[] | null;
  /** The chart band around each dwell; null: the app-wide default. */
  bandwidth_mhz: number | null;
  latest_version_number: number | null;
  unsaved: boolean;
  used_in: StrategyUse[];
  tests: StrategyTestUse[];
  created_at: string;
  updated_at: string;
}

export interface DwellStrategyUpdate {
  name?: string;
  /** Replaces the Platforms it covers; [] makes it a default dwell. */
  platform_ids?: string[];
  description?: string | null;
  manual_collect_time_ms?: number;
  dwells?: Dwell[];
  bandwidth_mhz?: number | null;
  /** Also save the result as a new version (when it differs from the latest). */
  save_version?: boolean;
  change_summary?: string | null;
}

export interface DwellStrategyNote {
  id: string;
  author_id: string | null;
  author_username: string | null;
  body: string;
  created_at: string;
}

/** A Strategy pinned in a dwell file. */
export interface DwellFileLink {
  id: string;
  strategy_id: string;
  strategy_name: string;
  platform_ids: string[];
  platform_names: string[];
  is_default: boolean;
  /** For an MDF's file: those of its Platforms the MDF doesn't pin. */
  platforms_not_in_mdf: string[] | null;
  pinned_version_id: string;
  pinned_version_number: number;
  latest_version_number: number;
  outdated: boolean;
  sort_order: number;
  /** The pinned version's dwells. */
  dwells: Dwell[];
}

export interface DwellFile {
  id: string;
  name: string;
  mdf_id: string | null;
  mdf_name: string | null;
  timeout: number;
  setup_time: number;
  notes: string | null;
  latest_version_number: number | null;
  unsaved: boolean;
  links: DwellFileLink[];
  created_at: string;
  updated_at: string;
}

export interface DwellFileSummary {
  id: string;
  name: string;
  mdf_id: string | null;
  mdf_name: string | null;
  strategy_count: number;
  platform_names: string[];
  outdated_count: number;
  latest_version_number: number | null;
  unsaved: boolean;
  updated_at: string;
}

export interface DwellFileUpdate {
  name?: string;
  mdf_id?: string | null;
  timeout?: number;
  setup_time?: number;
  notes?: string | null;
}

export interface DwellVersionDetail extends VersionSummary {
  snapshot: Record<string, unknown>;
}

export interface AppSettings {
  dwell_bandwidth_mhz: number;
  /** The most the AI chat gives the model at once, in tokens. */
  ai_chat_max_context_tokens: number;
  /** What each Outline page holds, by its path ("Parent › Page"). */
  outline_page_kinds: Record<string, string>;
}

/** "strategies" or "files": the two versioned kinds, for the shared version pages. */
export type DwellKind = "strategies" | "files";
const base = (kind: DwellKind) => (kind === "strategies" ? "/dwell-strategies" : "/dwell-files");

export const dwellsApi = {
  /** All, or those covering a Platform (with the default dwells too, if asked). */
  strategies: (platformId?: string, includeDefault = false) =>
    api.get<DwellStrategySummary[]>(
      platformId
        ? `/dwell-strategies?platform_id=${platformId}${includeDefault ? "&include_default=true" : ""}`
        : "/dwell-strategies",
    ),
  strategy: (id: string) => api.get<DwellStrategy>(`/dwell-strategies/${id}`),
  createStrategy: (input: {
    name: string;
    /** None: a default dwell. */
    platform_ids: string[];
    description?: string | null;
    copy_from_id?: string | null;
  }) =>
    api.post<DwellStrategy>("/dwell-strategies", input),
  updateStrategy: (id: string, input: DwellStrategyUpdate) => api.patch<DwellStrategy>(`/dwell-strategies/${id}`, input),
  deleteStrategy: (id: string) => api.delete<void>(`/dwell-strategies/${id}`),
  notes: (id: string) => api.get<DwellStrategyNote[]>(`/dwell-strategies/${id}/notes`),
  addNote: (id: string, body: string) => api.post<DwellStrategyNote>(`/dwell-strategies/${id}/notes`, { body }),
  deleteNote: (id: string, noteId: string) => api.delete<void>(`/dwell-strategies/${id}/notes/${noteId}`),

  files: () => api.get<DwellFileSummary[]>("/dwell-files"),
  file: (id: string) => api.get<DwellFile>(`/dwell-files/${id}`),
  createFile: (input: { name: string; mdf_id?: string | null }) => api.post<DwellFile>("/dwell-files", input),
  importFile: (file: File, name?: string, mdfId?: string | null) => {
    const form = new FormData();
    form.append("file", file);
    if (name) form.append("name", name);
    if (mdfId) form.append("mdf_id", mdfId);
    return api.post<DwellFile>("/dwell-files/import", form);
  },
  updateFile: (id: string, input: DwellFileUpdate) => api.patch<DwellFile>(`/dwell-files/${id}`, input),
  deleteFile: (id: string) => api.delete<void>(`/dwell-files/${id}`),
  /** The file as XML: as it stands, or a saved version. */
  xml: (id: string, version?: number) =>
    api.get<Blob>(`/dwell-files/${id}/xml${version ? `?version=${version}` : ""}`, { responseType: "blob" }),
  pin: (fileId: string, strategyId: string, versionId?: string | null) =>
    api.post<DwellFile>(`/dwell-files/${fileId}/strategies`, { strategy_id: strategyId, strategy_version_id: versionId ?? null }),
  repinLatest: (fileId: string) => api.post<DwellFile>(`/dwell-files/${fileId}/strategies/repin-latest`, {}),
  updateLink: (linkId: string, input: { strategy_version_id?: string; sort_order?: number }) =>
    api.patch<DwellFile>(`/dwell-file-strategies/${linkId}`, input),
  unpin: (linkId: string) => api.delete<DwellFile>(`/dwell-file-strategies/${linkId}`),

  versions: (kind: DwellKind, id: string) => api.get<VersionSummary[]>(`${base(kind)}/${id}/versions`),
  version: (kind: DwellKind, id: string, n: number) => api.get<DwellVersionDetail>(`${base(kind)}/${id}/versions/${n}`),
  diff: (kind: DwellKind, id: string, n: number, against?: number) =>
    api.get<EmitterDiffResult>(`${base(kind)}/${id}/versions/${n}/diff${against ? `?against=${against}` : ""}`),
  commit: (kind: DwellKind, id: string, summary?: string) =>
    api.post<VersionSummary>(`${base(kind)}/${id}/versions`, { change_summary: summary ?? null }),

  settings: () => api.get<AppSettings>("/settings"),
  updateSettings: (input: Partial<AppSettings>) => api.patch<AppSettings>("/settings", input),
};
