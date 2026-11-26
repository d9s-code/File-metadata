import { api } from "./client";

/** One of a radar's operational modes (volume search, track…). Its Modes
 * are linked to it and take its illumination time in the dwell planner. */
export interface OperationalMode {
  id: string;
  emitter_id: string;
  name: string;
  description: string | null;
  /** How long the beam lights up a Platform each scan in this mode, ms. Null: its Emitter's. */
  illumination_time_ms: number | null;
  sort_order: number;
  /** How many of the Emitter's Modes are linked to it. */
  modes_count: number;
  created_at: string;
  updated_at: string;
}

export interface OperationalModeInput {
  name: string;
  description?: string | null;
  illumination_time_ms?: number | null;
  sort_order?: number;
}

const base = (emitterId: string) => `/emitters/${emitterId}/operational-modes`;

export const operationalModesApi = {
  list: (emitterId: string) => api.get<OperationalMode[]>(base(emitterId)),
  create: (emitterId: string, input: OperationalModeInput) => api.post<OperationalMode>(base(emitterId), input),
  update: (emitterId: string, id: string, input: Partial<OperationalModeInput>) =>
    api.patch<OperationalMode>(`${base(emitterId)}/${id}`, input),
  delete: (emitterId: string, id: string) => api.delete<void>(`${base(emitterId)}/${id}`),
};
