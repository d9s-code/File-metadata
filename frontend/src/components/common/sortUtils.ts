export type SortDirection = "asc" | "desc";

/** Nulls always sort last, regardless of direction — same convention used
 * throughout this app's existing comparators (e.g. Modes table). */
export function compareNullable<V>(av: V | null | undefined, bv: V | null | undefined, dir: SortDirection): number {
  if (av == null && bv == null) return 0;
  if (av == null) return 1;
  if (bv == null) return -1;
  const cmp = av < bv ? -1 : av > bv ? 1 : 0;
  return dir === "asc" ? cmp : -cmp;
}

/** Numeric-aware string compare — "Mode 2" sorts before "Mode 10" instead of
 * after it, unlike plain lexicographic comparison (where '1' < '2' char by
 * char). Case-insensitive via `sensitivity: "base"`. */
export function naturalCompare(a: string, b: string, dir: SortDirection): number {
  const cmp = a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
  return dir === "asc" ? cmp : -cmp;
}

export function compareStrings(a: string | null | undefined, b: string | null | undefined, dir: SortDirection): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return naturalCompare(a, b, dir);
}
