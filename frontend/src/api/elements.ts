import { api } from "./client";
import type { ElementType, ElementVariant, ModeElement } from "../types/domain";

export interface ModeElementInput {
  element_type: ElementType;
  variant?: ElementVariant | null;
  value_min?: number | null;
  value_max?: number | null;
  stagger_values?: number[] | null;
  jitter_min?: number | null;
  jitter_max?: number | null;
  delta?: number | null;
  label?: string | null;
  details?: string | null;
  sort_order?: number;
}

export interface CartesianProductInput {
  ew_group_id: string;
  rf_element_ids: string[];
  pw_element_ids: string[];
  pri_element_ids: string[];
  sequence_ids?: string[];
  name_prefix: string;
  batch_note?: string | null;
  /** Per-element delta override for this run only — keyed by element id,
   * takes precedence over that element's own stored delta. */
  rf_delta_overrides?: Record<string, number>;
  pw_delta_overrides?: Record<string, number>;
  pri_delta_overrides?: Record<string, number>;
  /** Applied uniformly to every Mode Line this run generates. */
  rf_range_matching?: boolean;
  pw_range_matching?: boolean;
  pri_range_matching?: boolean;
}

export interface CartesianProductResult {
  created_mode_ids: string[];
  count: number;
}

function base(emitterId: string, sourceId: string) {
  return `/emitters/${emitterId}/sources/${sourceId}/elements`;
}

export const elementsApi = {
  list: (emitterId: string, sourceId: string) => api.get<ModeElement[]>(base(emitterId, sourceId)),
  create: (emitterId: string, sourceId: string, input: ModeElementInput) =>
    api.post<ModeElement>(base(emitterId, sourceId), input),
  delete: (emitterId: string, sourceId: string, elementId: string) =>
    api.delete<void>(`${base(emitterId, sourceId)}/${elementId}`),
  cartesianProduct: (emitterId: string, sourceId: string, input: CartesianProductInput) =>
    api.post<CartesianProductResult>(`${base(emitterId, sourceId)}/cartesian-product`, input),
};
