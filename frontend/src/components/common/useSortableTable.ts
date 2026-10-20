import { useMemo } from "react";
import type { SortDirection } from "./sortUtils";
import { useSessionState } from "./useSessionState";

/** Generic client-side table sort. Takes a per-table comparator rather than a
 * column-config object — each table's fields differ too much (nested
 * id-lookups, nullable numerics, date strings) to genericize further without
 * losing type safety. `storageKey` names the table, so its sort is kept for
 * the browser tab's session (a reload, or another page and back). */
export function useSortableTable<T, K extends string>(
  rows: T[],
  comparator: (a: T, b: T, key: K, dir: SortDirection) => number,
  storageKey: string,
  initial?: { key: K; dir: SortDirection },
) {
  const [sort, setSort] = useSessionState<{ key: K | null; dir: SortDirection }>(`sort:${storageKey}`, {
    key: initial?.key ?? null,
    dir: initial?.dir ?? "asc",
  });
  const sortKey = sort.key;
  const sortDir = sort.dir;

  function onSort(key: K, dir: SortDirection) {
    setSort({ key, dir });
  }

  function onClear() {
    setSort({ key: null, dir: sortDir });
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
