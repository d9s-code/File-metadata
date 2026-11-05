import { useCallback, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { mdfCoverageApi, type CoverageMode, type PlatformCoverage } from "../../api/platforms";
import { useEmitters } from "../../state/hooks/useEmitters";
import { LoadingState } from "../common/LoadingState";
import { EmptyState } from "../common/EmptyState";
import { FilterBar, shownCount } from "../common/FilterBar";
import { SortableColumnHeader } from "../common/SortableColumnHeader";
import { useSortableTable } from "../common/useSortableTable";
import { useSessionState } from "../common/useSessionState";
import { compareNullable, compareStrings, type SortDirection } from "../common/sortUtils";
import { statusLabel } from "../common/emitterStatusLabel";
import type { EmitterStatus } from "../../types/domain";

/** What an MDF's pinned Platform versions cover — shared with its Charts tab. */
export function useMdfCoverage(mdfId: string) {
  return useQuery({ queryKey: ["mdf-coverage", mdfId], queryFn: () => mdfCoverageApi.get(mdfId), enabled: !!mdfId });
}

type Range = [number, number] | null;

/** One Emitter version on the MDF, with every Platform that pins it. */
interface Row {
  key: string;
  emitterId: string;
  name: string;
  designation: string | null;
  version: number;
  /** Other Platforms pin this Emitter at a different version. */
  otherVersions: number[];
  platforms: { id: string; name: string; version: number }[];
  modes: CoverageMode[];
  status: EmitterStatus | null;
}

type SortKey = "name" | "designation" | "version" | "platforms" | "modes" | "types" | "rf" | "pri" | "pw" | "status";

/** The span of every Mode's range — raw, or engineered (± delta). */
function span(modes: CoverageMode[], pick: (m: CoverageMode) => Range): Range {
  let lo = Infinity;
  let hi = -Infinity;
  for (const m of modes) {
    const r = pick(m);
    if (!r) continue;
    lo = Math.min(lo, r[0]);
    hi = Math.max(hi, r[1]);
  }
  return lo <= hi ? [lo, hi] : null;
}

const fmt = (v: number) => v.toLocaleString(undefined, { maximumFractionDigits: 3 });
function RangeCell({ range }: { range: Range }) {
  if (!range) return <span className="hint-text">—</span>;
  return <span className="cell-nowrap">{range[0] === range[1] ? fmt(range[0]) : `${fmt(range[0])}–${fmt(range[1])}`}</span>;
}

const TYPE_ORDER = ["fixed", "stagger", "cw", "xlet"];
const TYPE_LABEL: Record<string, string> = { fixed: "Fixed", stagger: "Stagger", cw: "CW", xlet: "X-let" };
function typeCounts(modes: CoverageMode[]) {
  const counts = new Map<string, number>();
  for (const m of modes) counts.set(m.pri_type, (counts.get(m.pri_type) ?? 0) + 1);
  return [...counts].sort((a, b) => TYPE_ORDER.indexOf(a[0]) - TYPE_ORDER.indexOf(b[0]));
}

function toRows(coverage: PlatformCoverage[], statusById: Map<string, EmitterStatus>): Row[] {
  const rows = new Map<string, Row>();
  for (const p of coverage) {
    for (const e of p.emitters) {
      const key = `${e.emitter_id}:${e.version_number}`;
      const row = rows.get(key) ?? {
        key,
        emitterId: e.emitter_id,
        name: e.emitter_name,
        designation: e.designation,
        version: e.version_number,
        otherVersions: [],
        platforms: [],
        modes: e.modes,
        status: statusById.get(e.emitter_id) ?? null,
      };
      row.platforms.push({ id: p.platform_id, name: p.platform_name, version: p.version_number });
      rows.set(key, row);
    }
  }
  const versionsByEmitter = new Map<string, number[]>();
  for (const r of rows.values()) versionsByEmitter.set(r.emitterId, [...(versionsByEmitter.get(r.emitterId) ?? []), r.version]);
  for (const r of rows.values()) r.otherVersions = (versionsByEmitter.get(r.emitterId) ?? []).filter((v) => v !== r.version).sort((a, b) => a - b);
  return [...rows.values()];
}

/** Every Emitter on an MDF — through the Platform versions it pins, as the
 * export takes them — in one sortable table. An Emitter two Platforms pin at
 * different versions gets a row per version, flagged. */
export function MdfEmittersTable({ mdfId }: { mdfId: string }) {
  const { data: coverage, isLoading, error } = useMdfCoverage(mdfId);
  const { data: emitters } = useEmitters();
  const [search, setSearch] = useSessionState("mdfEmitters.search", "");
  const [engineered, setEngineered] = useSessionState("mdfEmitters.engineered", false);
  const [onlyMismatched, setOnlyMismatched] = useState(false);

  const statusById = useMemo(() => new Map((emitters ?? []).map((e) => [e.id, e.status])), [emitters]);
  const rows = useMemo(() => toRows(coverage ?? [], statusById), [coverage, statusById]);
  const ranges = useCallback(
    (r: Row) => ({
      rf: span(r.modes, (m) => (engineered ? m.rf : m.rf_raw)),
      pri: span(r.modes, (m) => (engineered ? m.pri : m.pri_raw)),
      pw: span(r.modes, (m) => (engineered ? m.pw : m.pw_raw)),
    }),
    [engineered],
  );

  const q = search.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      rows.filter(
        (r) =>
          (!onlyMismatched || r.otherVersions.length > 0) &&
          (!q ||
            [r.name, r.designation ?? "", ...r.platforms.map((p) => p.name)].some((t) => t.toLowerCase().includes(q))),
      ),
    [rows, q, onlyMismatched],
  );

  const compare = useCallback(
    (a: Row, b: Row, key: SortKey, dir: SortDirection) => {
      switch (key) {
        case "name":
          return compareStrings(a.name, b.name, dir) || a.version - b.version;
        case "designation":
          return compareNullable(a.designation?.toLowerCase(), b.designation?.toLowerCase(), dir) || compareStrings(a.name, b.name, "asc");
        case "version":
          return compareNullable(a.version, b.version, dir);
        case "platforms":
          return compareNullable(a.platforms.length, b.platforms.length, dir) || compareStrings(a.name, b.name, "asc");
        case "modes":
          return compareNullable(a.modes.length, b.modes.length, dir);
        case "types":
          return compareStrings(
            typeCounts(a.modes).map(([t]) => t).join(","),
            typeCounts(b.modes).map(([t]) => t).join(","),
            dir,
          );
        case "rf":
        case "pri":
        case "pw":
          // By the low end, then the high end; Emitters without the value last.
          return (
            compareNullable(ranges(a)[key]?.[0], ranges(b)[key]?.[0], dir) ||
            compareNullable(ranges(a)[key]?.[1], ranges(b)[key]?.[1], dir)
          );
        case "status":
          return compareNullable(a.status ? statusLabel(a.status) : null, b.status ? statusLabel(b.status) : null, dir);
      }
    },
    [ranges],
  );
  const { sorted, sortKey, sortDir, onSort, onClear } = useSortableTable<Row, SortKey>(filtered, compare, "mdfEmitters", {
    key: "name",
    dir: "asc",
  });

  if (isLoading) return <LoadingState label="Loading the MDF's Emitters…" />;
  if (error) return <div className="error-text">{(error as Error).message}</div>;
  if (rows.length === 0)
    return (
      <section className="card">
        <EmptyState icon="◇" title="No Emitters yet" message="Pin a Platform (on the Platforms tab) and its pinned Emitters show here." />
      </section>
    );

  const mismatched = new Set(rows.filter((r) => r.otherVersions.length > 0).map((r) => r.emitterId)).size;
  const distinct = new Set(rows.map((r) => r.emitterId)).size;
  const header = (label: string, key: SortKey, columnType?: "string" | "number" | "date") => (
    <SortableColumnHeader
      label={label}
      columnKey={key}
      columnType={columnType}
      activeKey={sortKey}
      activeDir={sortDir}
      onSort={onSort}
      onClear={onClear}
    />
  );

  return (
    <section className="card mdf-emitters">
      <div className="card-header">
        <h4>
          Emitters on this MDF <span className="hint-text">{distinct}</span>
        </h4>
        <span className="hint-text">As pinned by its Platform versions — what the MDF exports.</span>
      </div>
      {mismatched > 0 && (
        <p className="mdf-emitters-warning">
          ⚠ {mismatched} Emitter{mismatched === 1 ? " is" : "s are"} pinned at different versions by different Platforms.{" "}
          <button type="button" className="link-button" onClick={() => setOnlyMismatched((v) => !v)}>
            {onlyMismatched ? "Show all" : "Show only those"}
          </button>
        </p>
      )}
      <FilterBar
        active={!!search || onlyMismatched}
        onReset={() => {
          setSearch("");
          setOnlyMismatched(false);
        }}
        count={shownCount(sorted.length, rows.length, "row")}
      >
        <input
          type="search"
          placeholder="Emitter, designation or Platform…"
          aria-label="Filter by Emitter, designation or Platform"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <label className="checkbox-label" title="Ranges widened by each Mode's ± delta, as exported">
          <input type="checkbox" checked={engineered} onChange={(e) => setEngineered(e.target.checked)} />
          With deltas (±)
        </label>
      </FilterBar>
      {sorted.length === 0 ? (
        <EmptyState icon="◇" title="No matches" message="No Emitters match the filter." />
      ) : (
        <div className="table-scroll">
          <table className="data-table mdf-emitters-table">
            <thead>
              <tr>
                {header("Emitter", "name")}
                {header("Designation", "designation")}
                {header("Version", "version", "number")}
                {header("Pinned by", "platforms", "number")}
                {header("Modes", "modes", "number")}
                {header("PRI types", "types")}
                {header("RF (MHz)", "rf", "number")}
                {header("PRI / frame (µs)", "pri", "number")}
                {header("PW (µs)", "pw", "number")}
                {header("Status now", "status")}
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => {
                const { rf, pri, pw } = ranges(r);
                return (
                  <tr key={r.key} className={r.otherVersions.length > 0 ? "mdf-emitter-mismatch" : undefined}>
                    <td>
                      <Link to={`/emitters/${r.emitterId}`}>{r.name}</Link>
                    </td>
                    <td>{r.designation ?? <span className="hint-text">—</span>}</td>
                    <td className="cell-nowrap">
                      v{r.version}
                      {r.otherVersions.length > 0 && (
                        <span
                          className="mdf-emitter-flag"
                          title={`Other Platforms pin it at ${r.otherVersions.map((v) => `v${v}`).join(", ")}`}
                        >
                          ⚠ also {r.otherVersions.map((v) => `v${v}`).join(", ")}
                        </span>
                      )}
                    </td>
                    <td>
                      {r.platforms.map((p, i) => (
                        <span key={p.id}>
                          {i > 0 && ", "}
                          <Link to={`/platforms/${p.id}`} title={`Platform version v${p.version}`}>
                            {p.name}
                          </Link>
                        </span>
                      ))}
                    </td>
                    <td>{r.modes.length}</td>
                    <td className="cell-nowrap">
                      {typeCounts(r.modes).length === 0 ? (
                        <span className="hint-text">—</span>
                      ) : (
                        typeCounts(r.modes)
                          .map(([t, n]) => `${n} ${TYPE_LABEL[t] ?? t}`)
                          .join(" · ")
                      )}
                    </td>
                    <td>
                      <RangeCell range={rf} />
                    </td>
                    <td>
                      <RangeCell range={pri} />
                    </td>
                    <td>
                      <RangeCell range={pw} />
                    </td>
                    <td>{r.status ? statusLabel(r.status) : <span className="hint-text">—</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
