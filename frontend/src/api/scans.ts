import { api } from "./client";

/** One of an Emitter's scans: a pattern with its values and beamwidths, for
 * working out illumination time and revisit (see components/scans/scanPatterns).
 * Operational modes use one (the ones under them inherit it); a Mode can
 * use its own. Not exported. */
export interface EmitterScan {
  id: string;
  emitter_id: string;
  name: string;
  pattern: string;
  /** The pattern's values by name ("period_s"), each with an optional "<name>_delta". */
  params: Record<string, number> | null;
  beam_az_deg: number | null;
  beam_el_deg: number | null;
  /** Typed in: wins over the worked-out illumination time. */
  illumination_ms: number | null;
  description: string | null;
  sort_order: number;
  operational_modes_count: number;
  modes_count: number;
  created_at: string;
  updated_at: string;
}

export interface EmitterScanInput {
  name: string;
  pattern: string;
  params?: Record<string, number> | null;
  beam_az_deg?: number | null;
  beam_el_deg?: number | null;
  illumination_ms?: number | null;
  description?: string | null;
  sort_order?: number;
}

const base = (emitterId: string) => `/emitters/${emitterId}/scans`;

export const scansApi = {
  list: (emitterId: string) => api.get<EmitterScan[]>(base(emitterId)),
  create: (emitterId: string, input: EmitterScanInput) => api.post<EmitterScan>(base(emitterId), input),
  update: (emitterId: string, id: string, input: Partial<EmitterScanInput>) =>
    api.patch<EmitterScan>(`${base(emitterId)}/${id}`, input),
  delete: (emitterId: string, id: string) => api.delete<void>(`${base(emitterId)}/${id}`),
};
