import { api } from "./client";

/** Platform confidence (experimental): what in an MDF tells its Platforms apart. */
export interface UniquenessRef {
  platform_id: string;
  platform_name: string;
}

export interface UniquenessMode {
  mode_id: string;
  mode_name: string;
  ew_group_name: string;
  pri_type: string;
  /** No Mode on another Platform could be taken for it (the ambiguity check's test). */
  unique_set: boolean;
  /** Parameters no other Platform's Mode overlaps on their own: "rf", "pri", "pw", "scan". */
  unique_params: string[];
  overlap_count: number;
  overlaps: (UniquenessRef & { emitter_id: string; emitter_name: string; mode_id: string; mode_name: string })[];
}

export interface UniquenessEmitter {
  emitter_id: string;
  emitter_name: string;
  designation: string | null;
  version_number: number | null;
  /** Only this Platform pins it. */
  unique: boolean;
  shared_with: UniquenessRef[];
  /** A unique Emitter's Modes (a shared one's are on the other Platforms too). */
  modes: UniquenessMode[];
  mode_count: number;
  unique_set_count: number;
}

export interface UniquenessPlatform {
  platform_id: string;
  platform_name: string;
  version_label: string | null;
  emitters: UniquenessEmitter[];
  unique_emitter_count: number;
  unique_set_count: number;
  unique_pair_count: number;
  /** Shared Emitters no other Platform has together. */
  unique_pairs: { emitters: { emitter_id: string; emitter_name: string; designation: string | null }[] }[];
  /** Platforms that have every Emitter this one has. */
  covered_by: UniquenessRef[];
}

export interface MdfUniqueness {
  mdf_id: string;
  mdf_name: string;
  mdf_version_number: number;
  stagger_step_delta_us: number;
  platforms: UniquenessPlatform[];
}

export const pclApi = {
  uniqueness: (mdfId: string) => api.get<MdfUniqueness>(`/pcl/mdfs/${mdfId}/uniqueness`),
};
