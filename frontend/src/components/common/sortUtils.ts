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

export function compareStrings(a: string | null | undefined, b: string | null | undefined, dir: SortDirection): number {
  return compareNullable(a?.toLowerCase(), b?.toLowerCase(), dir);
}
