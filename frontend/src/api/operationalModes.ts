import { api } from "./client";

/** One of a radar's operational modes (volume search, track…), in a tree:
 * TRACK holds Track 1, 2, 3… Its Modes are linked to it and take its scan
 * (or the nearest one's above it) in the dwell planner. */
export interface OperationalMode {
  id: string;
  emitter_id: string;
  /** The one it sits under; null — at the top. */
  parent_id: string | null;
  name: string;
  description: string | null;
  /** The scan it uses (one of the Emitter's); null: the one above it's. */
  scan_id: string | null;
  /** What it transmits over time: a timeline and on/off periods (null: its Modes as they are, always on). */
  emission?: Emission | null;
  /** Its plan, for analysis: the values planned for it (null: none here). */
  plan?: OperationalModePlan | null;
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
  scan_id?: string | null;
  emission?: Emission | null;
  sort_order?: number;
  plan?: OperationalModePlan | null;
}

/** One step of an operational mode's timeline: one of the Emitter's Modes for
 * a number of pulses or a time (ms), or off for a time. */
export interface EmissionItem {
  kind: "group" | "off";
  mode_id?: string | null;
  pulses?: number | null;
  ms?: number | null;
}

/** An operational mode's timeline (repeated), and on/off periods: on for
 * on_s, silent for off_s (the ones under it take these unless they have their own). */
export interface Emission {
  timeline?: EmissionItem[];
  on_s?: number | null;
  off_s?: number | null;
}

/** One planned value: a single value (max empty) or a min–max, with a note;
 * a dwell & switch PRI's also how long it dwells there (pulses or ms). */
export interface PlannedValue {
  min: number;
  max?: number | null;
  note?: string | null;
  dwell_pulses?: number | null;
  dwell_ms?: number | null;
  /** A PRI's own PW (µs), when the plan pairs PW with PRI pulse to pulse. */
  pw_min?: number | null;
  pw_max?: number | null;
}

/** A planned stagger: its PRI steps in order (µs), the frame-time ± delta, a
 * note — and, paired pulse to pulse, each step's PW. */
export interface PlannedStagger {
  steps: number[];
  frame_time_delta_us?: number | null;
  note?: string | null;
  pw_steps?: number[] | null;
}

/** The values planned for an operational mode — several RF, PRI and PW each.
 * One it plans none of comes from the one above it. */
export interface OperationalModePlan {
  rf?: PlannedValue[];
  pri?: PlannedValue[];
  pri_dwell_switch?: boolean;
  /** PRI as staggers instead of values. */
  pri_stagger?: PlannedStagger[];
  /** PW goes with PRI, pulse to pulse: each PRI (or stagger step) carries its PW. */
  pri_pw_paired?: boolean;
  pw?: PlannedValue[];
}

/** A comment on an Emitter's plan: on one operational mode, or (none) on the whole. */
export interface PlanComment {
  id: string;
  emitter_id: string;
  operational_mode_id: string | null;
  operational_mode_name: string | null;
  parent_id: string | null;
  author_id: string | null;
  author_username: string | null;
  body: string;
  resolved: boolean;
  resolved_by_username: string | null;
  resolved_at: string | null;
  edited_at: string | null;
  created_at: string;
}

/** One Mode to make from a plan: RF (MHz), PRI and PW (µs) ranges. */
export interface PlannedCombination {
  rf_min_mhz: number;
  rf_max_mhz: number;
  /** A PRI range (a Fixed Mode), or… */
  pri_min_us?: number;
  pri_max_us?: number;
  /** …a stagger's steps (a Stagger Mode). */
  pri_stagger_values_us?: number[];
  frame_time_delta_us?: number | null;
  pw_min_us: number;
  pw_max_us: number;
}

export interface GenerateFromPlanInput {
  ew_group_id: string;
  source_id: string;
  name_prefix: string;
  combinations: PlannedCombination[];
  jitter_min_us?: number;
  jitter_max_us?: number;
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
  /** Every Mode under it a stagger: its steps (µs), and the frame-time delta. */
  pri_stagger_values_us?: number[];
  frame_time_delta_us?: number;
}

const base = (emitterId: string) => `/emitters/${emitterId}/operational-modes`;

export const operationalModesApi = {
  list: (emitterId: string) => api.get<OperationalMode[]>(base(emitterId)),
  create: (emitterId: string, input: OperationalModeInput) => api.post<OperationalMode>(base(emitterId), input),
  update: (emitterId: string, id: string, input: Partial<OperationalModeInput>) =>
    api.patch<OperationalMode>(`${base(emitterId)}/${id}`, input),
  delete: (emitterId: string, id: string) => api.delete<void>(`${base(emitterId)}/${id}`),
  /** One parent's operational modes, in this order. */
  order: (emitterId: string, parentId: string | null, ids: string[]) =>
    api.post<OperationalMode[]>(`${base(emitterId)}/order`, { parent_id: parentId, ids }),
  /** A Fixed Mode for each combination, linked to it, in one generation batch. */
  generate: (emitterId: string, id: string, input: GenerateFromPlanInput) =>
    api.post<{ updated_mode_ids: string[]; count: number }>(`${base(emitterId)}/${id}/generate`, input),
  comments: (emitterId: string) => api.get<PlanComment[]>(`/emitters/${emitterId}/plan-comments`),
  addComment: (emitterId: string, input: { body: string; operational_mode_id?: string | null; parent_id?: string | null }) =>
    api.post<PlanComment>(`/emitters/${emitterId}/plan-comments`, input),
  updateComment: (emitterId: string, id: string, input: { body?: string; resolved?: boolean }) =>
    api.patch<PlanComment>(`/emitters/${emitterId}/plan-comments/${id}`, input),
  deleteComment: (emitterId: string, id: string) => api.delete<void>(`/emitters/${emitterId}/plan-comments/${id}`),
  /** Sets these values on every Mode under it (it and all below), all or nothing. */
  setValues: (emitterId: string, id: string, values: SetValuesInput) =>
    api.post<{ updated_mode_ids: string[]; count: number }>(`${base(emitterId)}/${id}/set-values`, values),
};
