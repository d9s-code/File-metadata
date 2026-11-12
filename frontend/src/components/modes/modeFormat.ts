import type { EwGroup, Mode, Source } from "../../types/domain";
import { naturalCompare } from "../common/sortUtils";

/** A PRI type as a word: Fixed, Stagger, CW. */
export function priTypeLabel(priType: string): string {
  if (priType === "cw") return "CW";
  return priType.charAt(0).toUpperCase() + priType.slice(1);
}

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
  if (mode.line?.pri_range_matching) tags.push("PRI");
  if (mode.line?.pw_range_matching) tags.push("PW");
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

/** Every Source a Mode comes from (one or more), first one first. */
export function modeSourceIds(mode: Mode): string[] {
  return mode.source_ids?.length ? mode.source_ids : [mode.source_id];
}

export function searchableText(
  mode: Mode,
  ewGroup: EwGroup | undefined,
  source: Source | undefined,
): string {
  const parts = [
    mode.name,
    mode.pri_type,
    mode.notes ?? "",
    ewGroup?.name ?? "",
    mode.source_names?.length ? mode.source_names.join(" ") : (source?.name ?? ""),
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
  | "confirmation_quality"
  | "confirmation_quantity"
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
      return modeSourceIds(mode)
        .map((id) => sourcesById[id]?.name ?? "")
        .join(", ")
        .toLowerCase();
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
    case "confirmation_quality":
      return mode.confirmation_quality;
    case "confirmation_quantity":
      return mode.confirmation_quantity;
    case "last_tested":
      return mode.last_tested_at;
  }
}

/** Lowest and highest of some values (nulls left out); both null when there are none. */
export type Span = [number | null, number | null];

function span(values: (number | null | undefined)[]): Span {
  const nums = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  return nums.length ? [Math.min(...nums), Math.max(...nums)] : [null, null];
}

export interface BatchSpan {
  rf: Span;
  /** A Fixed Mode's PRI range and a Stagger's steps together. */
  pri: Span;
  pw: Span;
  rfDelta: Span;
  /** PRI delta for Fixed, frame-time delta for Stagger (as the PRI Δ column shows). */
  priDelta: Span;
  pwDelta: Span;
  jitter: Span;
  frameTime: Span;
  quality: Span;
  quantity: Span;
  priTypes: string[];
  ewGroupIds: string[];
}

/** What a collapsed generation batch spans: for each parameter, the lowest
 * and highest across its Modes, as the table shows them (raw or programmed). */
export function batchSpan(modes: Mode[], engineered: boolean): BatchSpan {
  const rf = modes.map((m) => rfDisplay(m, engineered));
  const pw = modes.map((m) => pwDisplay(m, engineered));
  const pri = modes.map((m) => priDisplay(m, engineered));
  const jft = modes.map((m) => jitterOrFrameTimeDisplay(m, engineered));
  const steps = modes.flatMap((m) => (m.pri_type === "stagger" ? (m.line?.pri_stagger_values_us ?? []) : []));
  return {
    rf: span(rf.flatMap((d) => [d.min, d.max])),
    pri: span([...pri.flatMap((d) => [d.min, d.max]), ...steps]),
    pw: span(pw.flatMap((d) => [d.min, d.max])),
    rfDelta: span(modes.map((m) => m.line?.rf_delta)),
    priDelta: span(modes.map((m) => (m.pri_type === "stagger" ? m.line?.frame_time_delta_us : m.line?.pri_delta))),
    pwDelta: span(modes.map((m) => m.line?.pw_delta)),
    jitter: span(jft.filter((d) => d.label === "jitter").flatMap((d) => [d.min, d.max])),
    frameTime: span(jft.filter((d) => d.label === "frametime").flatMap((d) => [d.min, d.max])),
    quality: span(modes.map((m) => m.confirmation_quality)),
    quantity: span(modes.map((m) => m.confirmation_quantity)),
    priTypes: [...new Set(modes.map((m) => priTypeLabel(m.pri_type)))],
    ewGroupIds: [...new Set(modes.map((m) => m.ew_group_id))],
  };
}

/** A span as text: "9000–9500", one value when they're the same, "—" when empty. */
export function spanText([lo, hi]: Span, unit = ""): string {
  if (lo == null || hi == null) return "—";
  const u = unit ? ` ${unit}` : "";
  return lo === hi ? `${lo}${u}` : `${lo}–${hi}${u}`;
}

export type DisplayRow = { type: "mode"; mode: Mode } | { type: "batch"; batchId: string; modes: Mode[] };

/** Groups a (already sorted/filtered) Modes list for display — when
 * `collapseBatches` is true, every generation batch with 2+ Modes in the
 * list becomes a single "batch" row (in the position of its first member,
 * carrying every member regardless of where the others land in sort order)
 * instead of N individual rows; a lone Mode from a batch, or any Mode with
 * no batch, renders normally. */
export function groupModesForDisplay(modes: Mode[], collapseBatches: boolean): DisplayRow[] {
  if (!collapseBatches) return modes.map((mode) => ({ type: "mode", mode }));

  const countByBatch = new Map<string, number>();
  for (const m of modes) {
    if (m.generation_batch_id) countByBatch.set(m.generation_batch_id, (countByBatch.get(m.generation_batch_id) ?? 0) + 1);
  }

  const rows: DisplayRow[] = [];
  const emittedBatches = new Set<string>();
  for (const m of modes) {
    const batchId = m.generation_batch_id;
    if (batchId && (countByBatch.get(batchId) ?? 0) >= 2) {
      if (emittedBatches.has(batchId)) continue;
      emittedBatches.add(batchId);
      rows.push({ type: "batch", batchId, modes: modes.filter((mm) => mm.generation_batch_id === batchId) });
    } else {
      rows.push({ type: "mode", mode: m });
    }
  }
  return rows;
}

export function compareModes(
  a: Mode,
  b: Mode,
  key: ModeSortKey,
  dir: SortDir,
  ewGroupsById: Record<string, EwGroup>,
  sourcesById: Record<string, Source>,
): number {
  // Ties (the same RF, EW Group, PRI type…) by name, then EW Group, always A–Z,
  // so equal values never come out in an arbitrary order.
  return (
    compareBy(a, b, key, dir, ewGroupsById, sourcesById) ||
    compareBy(a, b, "name", "asc", ewGroupsById, sourcesById) ||
    compareBy(a, b, "ew_group", "asc", ewGroupsById, sourcesById)
  );
}

function compareBy(
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
  // String fields (name, ew_group, source, ...) use numeric-aware collation so
  // "Mode 2" sorts before "Mode 10" instead of after it; numeric fields (rf_min,
  // pw_min, ...) are unaffected and keep plain numeric comparison.
  if (typeof av === "string" && typeof bv === "string") return naturalCompare(av, bv, dir);
  const cmp = av < bv ? -1 : av > bv ? 1 : 0;
  return dir === "asc" ? cmp : -cmp;
}
