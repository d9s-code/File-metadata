import { api } from "./client";
import type { ElementType, ModeElement } from "../types/domain";

export interface ModeElementInput {
  element_type: ElementType;
  value_min?: number | null;
  value_max?: number | null;
  stagger_values?: number[] | null;
  jitter_min?: number | null;
  jitter_max?: number | null;
  label?: string | null;
  sort_order?: number;
}

export interface CartesianProductInput {
  ew_group_id: string;
  rf_element_ids: string[];
  pw_element_ids: string[];
  pri_element_ids: string[];
  name_prefix?: string;
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
