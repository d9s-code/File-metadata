import { useMemo, useState } from "react";
import type { SortDirection } from "./sortUtils";

/** Generic client-side table sort. Takes a per-table comparator rather than a
 * column-config object — each table's fields differ too much (nested
 * id-lookups, nullable numerics, date strings) to genericize further without
 * losing type safety. */
export function useSortableTable<T, K extends string>(
  rows: T[],
  comparator: (a: T, b: T, key: K, dir: SortDirection) => number,
  initial?: { key: K; dir: SortDirection },
) {
  const [sortKey, setSortKey] = useState<K | null>(initial?.key ?? null);
  const [sortDir, setSortDir] = useState<SortDirection>(initial?.dir ?? "asc");

  function onSort(key: K, dir: SortDirection) {
    setSortKey(key);
    setSortDir(dir);
  }

  function onClear() {
    setSortKey(null);
  }

  const sorted = useMemo(() => {
    if (!sortKey) return rows;
    return [...rows].sort((a, b) => comparator(a, b, sortKey, sortDir));
    // `comparator` is intentionally in deps (not omitted) — some tables' comparators
    // close over lookup props (e.g. an id->name map) that can change independently
    // of `rows`/`sortKey`/`sortDir`; recomputing a small table's sort every render
    // is cheap, and a stale sort from a stale closure is not.
  }, [rows, sortKey, sortDir, comparator]);

  return { sorted, sortKey, sortDir, onSort, onClear };
}
