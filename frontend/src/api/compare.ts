import { api } from "./client";
import type { AmbiguityFinding } from "./ambiguity";
import type { EmitterCoverage } from "./platforms";

/** A pair of Modes, one from each Emitter, the ambiguity check would flag. */
export type CompareFinding = Pick<
  AmbiguityFinding,
  "mode_id_a" | "mode_id_b" | "rf_overlap_pct" | "pw_overlap_pct" | "pri_overlap_pct" | "combined_severity" | "details"
>;

export interface EmitterComparison {
  a: EmitterCoverage;
  b: EmitterCoverage;
  findings: CompareFinding[];
}

export const compareApi = {
  emitters: (a: string, b: string, aVersion?: number, bVersion?: number) => {
    const q = new URLSearchParams({ a, b });
    if (aVersion) q.set("a_version", String(aVersion));
    if (bVersion) q.set("b_version", String(bVersion));
    return api.get<EmitterComparison>(`/emitters/compare?${q}`);
  },
};
