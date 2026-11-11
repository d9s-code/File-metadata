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

export type PclLevel = 1 | 2 | 3;

export interface PclRef {
  kind: "emitter" | "mode";
  emitter_id: string;
  name: string;
  mode: string | null;
  on_platform: boolean;
  in_mdf: boolean;
  unique: boolean;
  shared_with: string[];
  /** Platforms that have it, when this one doesn't. */
  elsewhere: string[];
  mode_unique_set: boolean | null;
  mode_unique_params: string[];
}

/** How a condition fares in an MDF. */
export interface PclCheck {
  refs: PclRef[];
  own_ok: boolean;
  also_true_for: string[];
  could_be_true_for: string[];
  /** The smallest sets that meet it: what must be heard, and what mustn't. */
  ways: { needs: string[]; without: string[] }[];
  more_ways: number;
  fewest_needed: number;
  warnings: string[];
}

export interface PclRule {
  id: string;
  platform_id: string;
  level: PclLevel;
  text: string;
  note: string | null;
  check?: PclCheck;
}

export interface PclPlatformRules {
  platform_id: string;
  platform_name: string;
  rules: PclRule[];
  suggestions: { level: PclLevel; text: string; why: string }[];
}

export type PclCheckResult =
  | { ok: true; text: string; check: PclCheck | null }
  | { ok: false; message: string; position: number };

export interface PclWhatIf {
  platforms: {
    platform_id: string;
    platform_name: string;
    level: number;
    met: { id: string; level: number; text: string }[];
    rule_count: number;
  }[];
}

export const pclRulesApi = {
  forMdf: (mdfId: string) =>
    api.get<{ mdf_id: string; mdf_version_number: number; platforms: PclPlatformRules[] }>(`/pcl/mdfs/${mdfId}/rules`),
  check: (platformId: string, mdfId: string, text: string) =>
    api.post<PclCheckResult>("/pcl/check", { platform_id: platformId, mdf_id: mdfId, text }),
  create: (platformId: string, input: { level: PclLevel; text: string; note?: string | null }) =>
    api.post<PclRule>(`/pcl/platforms/${platformId}/rules`, input),
  update: (ruleId: string, input: { level?: PclLevel; text?: string; note?: string | null }) =>
    api.patch<PclRule>(`/pcl/rules/${ruleId}`, input),
  remove: (ruleId: string) => api.delete<void>(`/pcl/rules/${ruleId}`),
  whatIf: (mdfId: string, heard: { emitter_ids: string[]; modes: { emitter_id: string; mode: string }[] }) =>
    api.post<PclWhatIf>(`/pcl/mdfs/${mdfId}/what-if`, heard),
};
