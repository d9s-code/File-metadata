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
  /** Pinned Emitters (per Platform it covers) in each testing state; null for default dwells or before a save. */
  testing: Record<TestingState, number> | null;
}

/** A pinned Emitter's dwell testing against a Strategy. */
export type TestingState = "tested" | "stale" | "untested" | "not_covered";

export interface StrategyTestingRun {
  test_record_id: string;
  title: string;
  test_date: string;
  result: string;
  strategy_version_number: number;
  emitter_version_number: number | null;
  platform_test_id: string | null;
}

export interface StrategyTestingEmitter {
  emitter_id: string;
  emitter_name: string;
  designation: string | null;
  pinned_version_number: number;
  covering_dwells: number;
  state: TestingState;
  reason: string | null;
  /** The run it holds on (tested), or the newest that no longer does (stale). */
  run: StrategyTestingRun | null;
}

export interface StrategyTesting {
  strategy_id: string;
  version_number: number | null;
  platforms: { platform_id: string; platform_name: string; emitters: StrategyTestingEmitter[] }[];
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

/** An MDF using a dwell file, and the version of it that MDF pins. */
export interface DwellFileMdf {
  id: string;
  name: string;
  status: string;
  pinned_version_number: number;
  /** A newer saved version of the file than the one pinned (not flagged once the MDF is released). */
  outdated: boolean;
}

export interface DwellFile {
  id: string;
  name: string;
  /** The MDFs using it, each pinning a saved version. */
  mdfs: DwellFileMdf[];
  /** The Platforms those MDFs pin (null when no MDF uses it). */
  mdf_platform_ids: string[] | null;
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
  mdfs: DwellFileMdf[];
  strategy_count: number;
  platform_names: string[];
  outdated_count: number;
  latest_version_number: number | null;
  unsaved: boolean;
  updated_at: string;
}

export interface DwellFileUpdate {
  name?: string;
  timeout?: number;
  setup_time?: number;
  notes?: string | null;
}

/** A Strategy as the version of a file an MDF pins has it. */
export interface MdfDwellStrategy {
  strategy_id: string | null;
  name: string;
  version_number: number | null;
  latest_version_number: number | null;
  outdated: boolean;
  platform_ids: string[];
  platform_names: string[];
  is_default: boolean;
  dwell_count: number;
  /** The sum of its dwell times, ms. */
  cycle_ms: number;
  bandwidth_mhz: number | null;
  /** The pinned version's dwells, for its chart. */
  dwells: Dwell[];
}

/** A dwell file an MDF pins, at the version it pins. */
export interface MdfDwell {
  dwell_file_id: string;
  name: string;
  notes: string | null;
  pinned_version_id: string;
  pinned_version_number: number;
  pinned_at: string;
  pinned_version_saved_at: string;
  latest_version_number: number | null;
  latest_version_id: string | null;
  outdated: boolean;
  /** The file has changes not saved as a version yet. */
  file_changed: boolean;
  timeout: number;
  setup_time: number;
  strategies: MdfDwellStrategy[];
  /** The MDF's Platforms no Strategy in the file covers (none with a default dwell). */
  platforms_not_covered: string[];
  other_mdfs: DwellFileMdf[];
}

export interface DwellVersionDetail extends VersionSummary {
  snapshot: Record<string, unknown>;
}

/** What a new Mode starts with where it isn't given one. The frame-time margin
 * is on a stagger's frame time (the sum of its steps), never on each step. */
export interface ModeDefaults {
  confirmation_quality: number;
  confirmation_quantity: number;
  frame_time_delta_us: number;
  rf_delta: number;
  pri_delta: number;
  pw_delta: number;
  /** Each stagger step's ± buffer when steps are compared (ambiguity check,
   * a test run's logged steps) — not a Mode field. */
  stagger_step_delta_us: number;
}

export interface AppSettings {
  dwell_bandwidth_mhz: number;
  /** The most the AI chat gives the model at once, in tokens. */
  ai_chat_max_context_tokens: number;
  /** What each Outline page holds, by its path ("Parent › Page"). */
  outline_page_kinds: Record<string, string>;
  mode_defaults: ModeDefaults;
  /** What counts in change notes: each rule on or off (see CHANGE_NOTE_RULES). */
  change_notes_counts: Record<string, boolean>;
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
  testing: (id: string) => api.get<StrategyTesting>(`/dwell-strategies/${id}/testing`),
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
  /** With an MDF: pinned into it at v1. */
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
  /** The dwell files an MDF pins. */
  mdfFiles: (mdfId: string) => api.get<MdfDwell[]>(`/mdfs/${mdfId}/dwell-files`),
  /** Pin a file into an MDF: a saved version, or its latest. */
  pinIntoMdf: (mdfId: string, fileId: string, versionId?: string | null) =>
    api.post<MdfDwell[]>(`/mdfs/${mdfId}/dwell-files`, { dwell_file_id: fileId, dwell_file_version_id: versionId ?? null }),
  repinMdfLatest: (mdfId: string) => api.post<MdfDwell[]>(`/mdfs/${mdfId}/dwell-files/repin-latest`, {}),
  unpinFromMdf: (mdfId: string, fileId: string) => api.delete<void>(`/mdfs/${mdfId}/dwell-files/${fileId}`),
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
