import { api } from "./client";

/** One Merged Mode dwell: frequency in MHz (Hz in the file), times in ms. */
export interface MergedDwell {
  freq_mhz: number;
  dwell_time_ms: number;
  collect_time_ms: number;
}

export interface DwellStrategy {
  id: string;
  platform_id: string | null;
  platform_name: string | null;
  /** False when the file is for an MDF that doesn't pin this Platform. */
  platform_in_mdf: boolean | null;
  sort_order: number;
  manual_collect_time_ms: number;
  merged_mode: MergedDwell[];
  /** Kept as the file had them — not edited in the app. */
  rapid_df: Record<string, string> | null;
  split_mode: { collect_time: string; dwell_time: string; freqs: string[] }[] | null;
}

export interface DwellFile {
  id: string;
  name: string;
  mdf_id: string | null;
  mdf_name: string | null;
  timeout: number;
  setup_time: number;
  /** The chart band around each dwell; null: the app-wide default. */
  bandwidth_mhz: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  strategies: DwellStrategy[];
}

export interface DwellFileSummary {
  id: string;
  name: string;
  mdf_id: string | null;
  mdf_name: string | null;
  strategy_count: number;
  platform_names: string[];
  dwell_count: number;
  updated_at: string;
}

export interface DwellFileUpdate {
  name?: string;
  mdf_id?: string | null;
  timeout?: number;
  setup_time?: number;
  bandwidth_mhz?: number | null;
  notes?: string | null;
}

export interface DwellStrategyUpdate {
  platform_id?: string | null;
  manual_collect_time_ms?: number;
  merged_mode?: MergedDwell[];
  sort_order?: number;
}

export interface AppSettings {
  dwell_bandwidth_mhz: number;
}

export const dwellsApi = {
  list: () => api.get<DwellFileSummary[]>("/dwells"),
  get: (id: string) => api.get<DwellFile>(`/dwells/${id}`),
  create: (input: { name: string; mdf_id?: string | null }) => api.post<DwellFile>("/dwells", input),
  importXml: (file: File, name?: string, mdfId?: string | null) => {
    const form = new FormData();
    form.append("file", file);
    if (name) form.append("name", name);
    if (mdfId) form.append("mdf_id", mdfId);
    return api.post<DwellFile>("/dwells/import", form);
  },
  update: (id: string, input: DwellFileUpdate) => api.patch<DwellFile>(`/dwells/${id}`, input),
  delete: (id: string) => api.delete<void>(`/dwells/${id}`),
  xml: (id: string) => api.get<Blob>(`/dwells/${id}/xml`, { responseType: "blob" }),
  addStrategy: (id: string, platformId: string | null) =>
    api.post<DwellFile>(`/dwells/${id}/strategies`, { platform_id: platformId }),
  updateStrategy: (strategyId: string, input: DwellStrategyUpdate) =>
    api.patch<DwellFile>(`/dwell-strategies/${strategyId}`, input),
  deleteStrategy: (strategyId: string) => api.delete<DwellFile>(`/dwell-strategies/${strategyId}`),
  settings: () => api.get<AppSettings>("/settings"),
  updateSettings: (input: Partial<AppSettings>) => api.patch<AppSettings>("/settings", input),
};
