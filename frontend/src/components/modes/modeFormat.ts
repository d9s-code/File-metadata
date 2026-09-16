import type { EwGroup, Mode, Source } from "../../types/domain";

export function formatPri(mode: Mode): string {
  const line = mode.line;
  if (!line) return "—";
  switch (mode.pri_type) {
    case "fixed":
      return `${line.pri_min_us}–${line.pri_max_us} µs (jitter ${line.jitter_min_us}–${line.jitter_max_us})`;
    case "stagger":
      return `[${(line.pri_stagger_values_us ?? []).join(", ")}] µs`;
    case "cw":
      return "CW (constant)";
    case "xlet":
      return "—";
  }
}

export interface ParamDisplay {
  min: number | null;
  max: number | null;
  /** Shown as a shaded subline under the max value — only in raw (non-engineered) mode. */
  delta: number | null;
}

/** RF/PW/PRI(fixed)'s min/max, either raw (with its delta broken out
 * separately, to render as a subline the way jitter already is) or the
 * already-combined engineered range the backend computes — same
 * raw-vs-engineered toggle for all three parameters. */
export function rfDisplay(mode: Mode, engineered: boolean): ParamDisplay {
  const line = mode.line;
  if (!line) return { min: null, max: null, delta: null };
  if (engineered) return { min: line.engineered_rf_min_mhz, max: line.engineered_rf_max_mhz, delta: null };
  return { min: line.rf_min_mhz, max: line.rf_max_mhz, delta: line.rf_delta ?? null };
}

export function pwDisplay(mode: Mode, engineered: boolean): ParamDisplay {
  const line = mode.line;
  if (!line) return { min: null, max: null, delta: null };
  if (engineered) return { min: line.engineered_pw_min_us, max: line.engineered_pw_max_us, delta: null };
  return { min: line.pw_min_us, max: line.pw_max_us, delta: line.pw_delta ?? null };
}

/** Fixed PRI only — Stagger/CW/Xlet have no single min/max pair here. */
export function priDisplay(mode: Mode, engineered: boolean): ParamDisplay {
  const line = mode.line;
  if (!line || mode.pri_type !== "fixed") return { min: null, max: null, delta: null };
  if (engineered) return { min: line.engineered_pri_min_us, max: line.engineered_pri_max_us, delta: null };
  return { min: line.pri_min_us ?? null, max: line.pri_max_us ?? null, delta: line.pri_delta ?? null };
}

export interface JitterOrFrameTimeDisplay {
  min: number | null;
  max: number | null;
  /** "jitter" for Fixed, "frametime" for Stagger — printed alongside the
   * value since both share the same pair of columns and a bare number
   * wouldn't say which one it is at a glance. */
  label: "jitter" | "frametime" | null;
  /** Frame time only, raw mode only — frame_time_us is a single nominal
   * value (not a min/max pair) with a tolerance delta on top, unlike
   * jitter which is already a stored min/max range. */
  delta: number | null;
}

/** Jitter (Fixed) and frame time (Stagger) share one pair of table
 * columns — a Mode is never both, so nothing is lost by not giving each
 * its own pair. */
export function jitterOrFrameTimeDisplay(mode: Mode, engineered: boolean): JitterOrFrameTimeDisplay {
  const line = mode.line;
  if (!line) return { min: null, max: null, label: null, delta: null };
  if (mode.pri_type === "fixed") {
    return { min: line.jitter_min_us ?? null, max: line.jitter_max_us ?? null, label: "jitter", delta: null };
  }
  if (mode.pri_type === "stagger") {
    if (engineered) {
      return {
        min: line.engineered_frame_time_min_us,
        max: line.engineered_frame_time_max_us,
        label: "frametime",
        delta: null,
      };
    }
    return { min: line.frame_time_us, max: null, label: "frametime", delta: line.frame_time_delta_us ?? null };
  }
  return { min: null, max: null, label: null, delta: null };
}

/** Which of RF/PW/PRI have range matching set on this Mode's current line —
 * empty if none. Set per parameter via the Mode form / a draft edit, same
 * governance as any other line field. */
export function rangeMatchingTags(mode: Mode): string[] {
  const tags: string[] = [];
  if (mode.line?.rf_range_matching) tags.push("RF");
  if (mode.line?.pw_range_matching) tags.push("PW");
  if (mode.line?.pri_range_matching) tags.push("PRI");
  return tags;
}

/** No filter applied when both ends are blank. Otherwise a Mode matches only
 * if it actually has a value for this parameter AND that value's range
 * overlaps the filter range at all — mirrors the same helper on the
 * Emitters list page. */
export function rangeOverlaps(filterMin: string, filterMax: string, valueMin: number | null | undefined, valueMax: number | null | undefined): boolean {
  if (!filterMin && !filterMax) return true;
  if (valueMin == null || valueMax == null) return false;
  const fMin = filterMin ? Number(filterMin) : -Infinity;
  const fMax = filterMax ? Number(filterMax) : Infinity;
  return valueMin <= fMax && valueMax >= fMin;
}

export function searchableText(mode: Mode, ewGroup: EwGroup | undefined, source: Source | undefined): string {
  const parts = [
    mode.name,
    mode.pri_type,
    mode.notes ?? "",
    ewGroup?.name ?? "",
    source?.name ?? "",
    mode.line?.dsl_text ?? "",
    mode.line ? `${mode.line.rf_min_mhz} ${mode.line.rf_max_mhz}` : "",
    mode.line ? `${mode.line.pw_min_us} ${mode.line.pw_max_us}` : "",
    mode.line?.pri_min_us != null ? `${mode.line.pri_min_us} ${mode.line.pri_max_us}` : "",
    mode.line?.pri_stagger_values_us?.join(" ") ?? "",
    mode.last_test_result ?? "",
  ];
  return parts.join(" ").toLowerCase();
}

export type ModeSortKey =
  | "name"
  | "ew_group"
  | "source"
  | "rf_min"
  | "rf_max"
  | "pw_min"
  | "pw_max"
  | "pri_type"
  | "pri_min"
  | "pri_max"
  | "range_matching"
  | "last_tested";

export type SortDir = "asc" | "desc";

function sortValue(
  mode: Mode,
  key: ModeSortKey,
  ewGroupsById: Record<string, EwGroup>,
  sourcesById: Record<string, Source>,
): string | number | null {
  switch (key) {
    case "name":
      return mode.name.toLowerCase();
    case "ew_group":
      return (ewGroupsById[mode.ew_group_id]?.name ?? "").toLowerCase();
    case "source":
      return (sourcesById[mode.source_id]?.name ?? "").toLowerCase();
    case "rf_min":
      return mode.line?.rf_min_mhz ?? null;
    case "rf_max":
      return mode.line?.rf_max_mhz ?? null;
    case "pw_min":
      return mode.line?.pw_min_us ?? null;
    case "pw_max":
      return mode.line?.pw_max_us ?? null;
    case "pri_type":
      return mode.pri_type;
    case "pri_min":
      return mode.line?.pri_min_us ?? null;
    case "pri_max":
      return mode.line?.pri_max_us ?? null;
    case "range_matching":
      return rangeMatchingTags(mode).join(",") || null;
    case "last_tested":
      return mode.last_tested_at;
  }
}

export function compareModes(
  a: Mode,
  b: Mode,
  key: ModeSortKey,
  dir: SortDir,
  ewGroupsById: Record<string, EwGroup>,
  sourcesById: Record<string, Source>,
): number {
  const av = sortValue(a, key, ewGroupsById, sourcesById);
  const bv = sortValue(b, key, ewGroupsById, sourcesById);
  // Nulls (e.g. PRI min/max on a Stagger/CW mode) always sort last, regardless of direction.
  if (av == null && bv == null) return 0;
  if (av == null) return 1;
  if (bv == null) return -1;
  const cmp = av < bv ? -1 : av > bv ? 1 : 0;
  return dir === "asc" ? cmp : -cmp;
}
