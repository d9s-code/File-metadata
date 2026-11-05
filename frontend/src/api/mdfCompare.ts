import { api } from "./client";

export type MdfChange = "added" | "removed" | "changed" | "same";

export interface MdfCompareSide {
  mdf_id: string;
  mdf_name: string;
  /** null: as it is now (its current pins). */
  version: number | null;
  saved_at: string | null;
  status: string;
}

export interface MdfComparePlatform {
  platform_id: string;
  name: string;
  change: MdfChange;
  from_version: number | null;
  to_version: number | null;
  /** "3", or "3.1" for a minor version. */
  from_version_label?: string | null;
  to_version_label?: string | null;
  from_status: string | null;
  to_status: string | null;
  status_changed: boolean;
  emitters_added: string[];
  emitters_removed: string[];
  emitter_count: number;
}

export interface MdfCompareEmitter {
  emitter_id: string;
  name: string;
  change: MdfChange;
  from_versions: number[];
  to_versions: number[];
  from_status: string | null;
  to_status: string | null;
  status_changed: boolean;
  platforms: string[];
  modes_added: number;
  modes_removed: number;
  modes_changed: number;
}

export interface MdfCompareMode {
  mode_id: string;
  name: string;
  old_name: string | null;
  emitter_id: string;
  emitter_name: string;
  group_name: string | null;
  change: Exclude<MdfChange, "same">;
  fields: string[];
  summary: string;
  old_summary: string | null;
  new_emitter: boolean;
}

type Tally = { added: number; removed: number; status_changed: number };

export interface MdfComparison {
  a: MdfCompareSide;
  b: MdfCompareSide;
  counts: { platforms: Tally; emitters: Tally; modes: { added: number; removed: number; changed: number } };
  platforms: MdfComparePlatform[];
  emitters: MdfCompareEmitter[];
  modes: MdfCompareMode[];
}

export const mdfCompareApi = {
  /** A version left out means the MDF as it is now. */
  compare: (a: string, b: string, aVersion: number | null, bVersion: number | null) => {
    const q = new URLSearchParams({ a, b });
    if (aVersion != null) q.set("a_version", String(aVersion));
    if (bVersion != null) q.set("b_version", String(bVersion));
    return api.get<MdfComparison>(`/mdfs/compare?${q}`);
  },
};
