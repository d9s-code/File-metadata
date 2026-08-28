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
