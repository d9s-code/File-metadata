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

export interface SequenceStepSelection {
  sequence_id: string;
  order: number;
  /** Per-step, run-only delta override — takes precedence over the
   * sequence's own stored delta for this run only. */
  rf_delta?: number;
  pw_delta?: number;
  pri_delta?: number;
}

export interface CartesianProductInput {
  ew_group_id: string;
  rf_element_ids: string[];
  pw_element_ids: string[];
  pri_element_ids: string[];
  sequence_steps?: SequenceStepSelection[];
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
  /** Stagger: the PRI Elements in their firing order — or a picked
   * sequence's PRI steps in step order — make one stagger train. */
  pri_type?: "fixed" | "stagger";
  /** Stagger from Elements: each PRI Element's 1-based position(s). */
  pri_firing_order?: Record<string, number[]>;
}

export interface CartesianProductResult {
  created_mode_ids: string[];
  count: number;
}

/** One distinct Element (type and values) across the Emitter's Sources. */
export interface ElementOverviewRow {
  element_type: ElementType;
  value_min: number | null;
  value_max: number | null;
  stagger_values: number[] | null;
  jitter_min: number | null;
  jitter_max: number | null;
  occurrences: {
    element_id: string;
    source_id: string;
    source_name: string;
    variant: ElementVariant | null;
    label: string | null;
    delta: number | null;
  }[];
}

export type Coverage = "covered" | "partial" | "not_covered";

/** A distinct Element and how much of it the Modes (for scan: the EW Groups) cover. */
export interface ElementCoverageRow extends ElementOverviewRow {
  coverage: Coverage;
  covered_by: { id: string; name: string; kind: "mode" | "ew_group" }[];
}

/** A Mode's (or EW Group's) range with its margin; `step` is one step of a Stagger Mode. */
export interface CoverageRange {
  id: string;
  name: string;
  kind: "mode" | "ew_group";
  group: string;
  min: number;
  max: number;
  step: boolean;
}

export interface ElementCoverage {
  elements: ElementCoverageRow[];
  ranges: Record<ElementType, CoverageRange[]>;
  summary: Record<ElementType, Record<Coverage, number>>;
}

/** An Element as it was used in a cartesian run (delta: the margin used). */
export interface CartesianRunElement {
  element_type: ElementType;
  label: string | null;
  variant: ElementVariant | null;
  value_min: number | null;
  value_max: number | null;
  stagger_values: number[] | null;
  jitter_min: number | null;
  jitter_max: number | null;
  delta: number | null;
  delta_overridden: boolean;
  /** Stagger runs: this PRI Element's place(s) in the train. */
  firing_order?: number[] | null;
}

/** One entry of a Source's generation log. */
export interface CartesianRun {
  id: string;
  created_at: string;
  created_by_username: string | null;
  ew_group_name: string;
  name_prefix: string;
  note: string | null;
  inputs: {
    /** Missing on runs logged before the PRI type choice: Fixed. */
    pri_type?: "fixed" | "stagger";
    elements: CartesianRunElement[];
    sequence_steps: {
      sequence_label: string | null;
      variant: ElementVariant | null;
      order: number;
      values: Record<string, number>;
      rf_delta: number | null;
      pw_delta: number | null;
      pri_delta: number | null;
    }[];
    range_matching: { rf: boolean; pri: boolean; pw: boolean };
  };
  mode_names: string[];
  modes_remaining: number;
}

function base(emitterId: string, sourceId: string) {
  return `/emitters/${emitterId}/sources/${sourceId}/elements`;
}

export interface ElementBatchResult {
  created: number;
  sources: number;
  /** The Source made for them, when `newSource` was given. */
  new_source_id: string | null;
}

/** A Source to create for the Elements in the same request. */
export interface NewSourceInput {
  name: string;
  source_date: string;
  description?: string;
  source_type?: string;
}

export const elementsApi = {
  /** Every Element to every one of the Sources, each its own Element — all or nothing. */
  batch: (emitterId: string, sourceIds: string[], elements: ModeElementInput[], newSource?: NewSourceInput) =>
    api.post<ElementBatchResult>(`/emitters/${emitterId}/sources/batch-elements`, {
      source_ids: sourceIds,
      elements,
      new_source: newSource,
    }),
  list: (emitterId: string, sourceId: string) => api.get<ModeElement[]>(base(emitterId, sourceId)),
  create: (emitterId: string, sourceId: string, input: ModeElementInput) =>
    api.post<ModeElement>(base(emitterId, sourceId), input),
  delete: (emitterId: string, sourceId: string, elementId: string) =>
    api.delete<void>(`${base(emitterId, sourceId)}/${elementId}`),
  overview: (emitterId: string) => api.get<ElementOverviewRow[]>(`/emitters/${emitterId}/element-overview`),
  coverage: (emitterId: string) => api.get<ElementCoverage>(`/emitters/${emitterId}/element-coverage`),
  cartesianRuns: (emitterId: string, sourceId: string) =>
    api.get<CartesianRun[]>(`/emitters/${emitterId}/sources/${sourceId}/cartesian-runs`),
  /** Modes from All Sources: the merged Elements of every Source. Any Element
   * of a merged group picks the group; each Mode gets the Sources its
   * Elements were found in. */
  allSourcesProduct: (emitterId: string, input: CartesianProductInput) =>
    api.post<CartesianProductResult>(`/emitters/${emitterId}/sources/all-sources/cartesian-product`, input),
  cartesianProduct: (emitterId: string, sourceId: string, input: CartesianProductInput) =>
    api.post<CartesianProductResult>(`${base(emitterId, sourceId)}/cartesian-product`, input),
};
