import { api } from "./client";

/** One of a radar's operational modes (volume search, track…), in a tree:
 * TRACK holds Track 1, 2, 3… Its Modes are linked to it and take its
 * illumination time (or the nearest one's above it) in the dwell planner. */
export interface OperationalMode {
  id: string;
  emitter_id: string;
  /** The one it sits under; null — at the top. */
  parent_id: string | null;
  name: string;
  description: string | null;
  /** How long the beam lights up a Platform each scan in this mode, ms. Null: its Emitter's. */
  illumination_time_ms: number | null;
  sort_order: number;
  /** How many of the Emitter's Modes are linked to it directly. */
  modes_count: number;
  created_at: string;
  updated_at: string;
}

export interface OperationalModeInput {
  name: string;
  parent_id?: string | null;
  description?: string | null;
  illumination_time_ms?: number | null;
  sort_order?: number;
}

/** Values set on every Mode under an operational mode. */
export interface SetValuesInput {
  rf_min_mhz?: number;
  rf_max_mhz?: number;
  rf_delta?: number;
  pw_min_us?: number;
  pw_max_us?: number;
  pw_delta?: number;
  pri_min_us?: number;
  pri_max_us?: number;
  pri_delta?: number;
  jitter_min_us?: number;
  jitter_max_us?: number;
}

const base = (emitterId: string) => `/emitters/${emitterId}/operational-modes`;

export const operationalModesApi = {
  list: (emitterId: string) => api.get<OperationalMode[]>(base(emitterId)),
  create: (emitterId: string, input: OperationalModeInput) => api.post<OperationalMode>(base(emitterId), input),
  update: (emitterId: string, id: string, input: Partial<OperationalModeInput>) =>
    api.patch<OperationalMode>(`${base(emitterId)}/${id}`, input),
  delete: (emitterId: string, id: string) => api.delete<void>(`${base(emitterId)}/${id}`),
  /** Sets these values on every Mode under it (it and all below), all or nothing. */
  setValues: (emitterId: string, id: string, values: SetValuesInput) =>
    api.post<{ updated_mode_ids: string[]; count: number }>(`${base(emitterId)}/${id}/set-values`, values),
};
