import { useMemo, useState } from "react";
import { fmt, niceTicks, useWidth } from "../../intercepts/charts/Histogram";
import {
  domainOf,
  RESULT_STATUS,
  resultStatus,
  withLimits,
  type AxisLimits,
  type ChartEntry,
  type ChartParam,
  type ModeRanges,
  type Span,
  spanOf,
  valueOf,
} from "./modeRanges";
import type { Mode } from "../../../types/domain";

const ROW = 26;
const HEAD = 54;
const GAP = 26;
const PAD = 12;
/** Squares shown in a combination cell before the rest are counted. */
const CELL_SQUARES = 12;

const PARAMS: { key: ChartParam; label: string; unit: string }[] = [
  { key: "rf", label: "RF", unit: "MHz" },
  { key: "pri", label: "PRI / frame time", unit: "µs" },
  { key: "pw", label: "PW", unit: "µs" },
];
const LABEL = Object.fromEntries(PARAMS.map((p) => [p.key, p])) as Record<ChartParam, (typeof PARAMS)[number]>;
// The worst result first, so a bar's colours read left to right from bad to good.
const STATUS_ORDER = ["fail", "partial", "inconclusive", "untested", "pass"] as const;

const rawOf = (r: ModeRanges, p: ChartParam): Span | null => (p === "rf" ? r.rfRaw : p === "pri" ? r.priRaw : r.pwRaw);
const spanText = (s: Span) => (s[0] === s[1] ? fmt(s[0]) : `${fmt(s[0])}–${fmt(s[1])}`);

/** One distinct range of a parameter, and the Modes that have it. */
interface Group {
  key: string;
  eng: Span | null;
  raw: Span | null;
  modes: Mode[];
}

/** A parameter's distinct ranges (raw and engineered alike), lowest first;
 * Modes without the parameter (CW has no PRI or PW) form a "—" group last. */
function groupsOf(ranges: ModeRanges[], p: ChartParam): Group[] {
  const byKey = new Map<string, Group>();
  for (const r of ranges) {
    const eng = spanOf(r, p);
    const raw = rawOf(r, p);
    const key = eng && raw ? `${raw[0]}|${raw[1]}|${eng[0]}|${eng[1]}` : "none";
    const group = byKey.get(key) ?? { key, eng: eng && raw ? eng : null, raw: eng && raw ? raw : null, modes: [] };
    group.modes.push(r.mode);
    byKey.set(key, group);
  }
  return [...byKey.values()].sort(
    (a, b) => (a.raw?.[0] ?? Infinity) - (b.raw?.[0] ?? Infinity) || (a.raw?.[1] ?? 0) - (b.raw?.[1] ?? 0),
  );
}

/** How many of the Modes ended each way in their last test — worst first. */
function statusCounts(modes: Mode[]) {
  return STATUS_ORDER.map((k) => ({ k, n: modes.filter((m) => (m.last_test_result ?? "untested") === k).length })).filter(
    (c) => c.n > 0,
  );
}

function namesList(modes: Mode[]) {
  const names = modes.map((m) => m.name).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  return names.length > 15 ? `${names.slice(0, 15).join(", ")} and ${names.length - 15} more` : names.join(", ");
}

/** The Modes drawn by value rather than one row each — for an Emitter whose
 * Modes are combinations of a few RF, PRI and PW ranges (4 RF × 4 PRI × 1 PW
 * is 16 Modes but only 9 ranges). Each parameter lists its distinct ranges
 * once, with how many Modes have it; the grid below shows which combinations
 * of two parameters exist, one square per Mode. */
export function ModeGroups({
  ranges,
  entries,
  fitEntries,
  limits,
  onOpen,
}: {
  ranges: ModeRanges[];
  entries: ChartEntry[];
  fitEntries: boolean;
  limits: AxisLimits;
  onOpen: (mode: Mode) => void;
}) {
  const { ref, width } = useWidth<HTMLDivElement>();
  const groups = useMemo(
    () => Object.fromEntries(PARAMS.map(({ key }) => [key, groupsOf(ranges, key)])) as Record<ChartParam, Group[]>,
    [ranges],
  );
  // A Mode picked out from the grid or a range: its ranges are marked.
  const [hover, setHover] = useState<{ param: ChartParam; key: string } | null>(null);
  const hoveredModes = useMemo(
    () => new Set(hover ? (groups[hover.param].find((g) => g.key === hover.key)?.modes.map((m) => m.id) ?? []) : []),
    [hover, groups],
  );

  const domains = useMemo(() => {
    const entryValues = (p: ChartParam) => entries.flatMap((e) => (valueOf(e, p) == null ? [] : [valueOf(e, p)!]));
    return Object.fromEntries(
      PARAMS.map(({ key }) => [
        key,
        withLimits(domainOf(ranges.map((r) => spanOf(r, key)), fitEntries ? entryValues(key) : []), limits[key]),
      ]),
    ) as Record<ChartParam, Span>;
  }, [ranges, entries, fitEntries, limits]);

  const panelW = Math.max(60, (width - GAP * (PARAMS.length - 1) - 2 * PAD * PARAMS.length) / PARAMS.length);
  const panelX = (i: number) => PAD + i * (panelW + 2 * PAD + GAP);
  const boxX = (i: number) => panelX(i) - PAD;
  const boxW = panelW + 2 * PAD;
  const rows = Math.max(...PARAMS.map(({ key }) => groups[key].length), 1);
  const height = HEAD + rows * ROW + 8;
  const sx = (p: ChartParam, i: number, v: number) => {
    const [lo, hi] = domains[p];
    return panelX(i) + ((v - lo) / (hi - lo || 1)) * panelW;
  };

  return (
    <>
      <div className="viz-card">
        <div className="viz-card-header">
          <strong>Distinct ranges</strong>
          <span className="hint-text">
            {PARAMS.map(({ key, label }) => `${groups[key].filter((g) => g.raw).length} ${label.split(" ")[0]}`).join(" × ")} ranges
            across {ranges.length} Mode{ranges.length === 1 ? "" : "s"} · each bar coloured by its Modes&apos; last test results
          </span>
        </div>
        <div ref={ref} className="viz-plot" onPointerLeave={() => setHover(null)}>
          <svg width={width} height={height} aria-label="Each parameter's distinct ranges, with how many Modes have each">
            <defs>
              {PARAMS.map((p, i) => (
                <clipPath key={p.key} id={`groups-clip-${p.key}`}>
                  <rect x={panelX(i) - 1} y={0} width={panelW + 2} height={height} />
                </clipPath>
              ))}
            </defs>
            {PARAMS.map((p, i) => {
              const [lo, hi] = domains[p.key];
              return (
                <g key={p.key}>
                  <rect className="ladder-panel" x={boxX(i)} y={1} width={boxW} height={height - 2} rx={6} />
                  <text className="ladder-title" x={panelX(i)} y={17}>
                    {p.label}
                    <tspan className="ladder-title-unit"> {p.unit}</tspan>
                  </text>
                  <line className="ladder-panel-rule" x1={boxX(i)} x2={boxX(i) + boxW} y1={HEAD - 2} y2={HEAD - 2} />
                  {niceTicks(lo, hi, 4).map((t) => (
                    <g key={t}>
                      <line className="viz-grid" x1={sx(p.key, i, t)} x2={sx(p.key, i, t)} y1={HEAD - 2} y2={height - 6} />
                      <text className="viz-axis-label" x={sx(p.key, i, t)} y={33} textAnchor="middle">
                        {fmt(t)}
                      </text>
                    </g>
                  ))}
                  {entries.map((e, k) => {
                    const v = valueOf(e, p.key);
                    if (v == null || v < lo || v > hi) return null;
                    return (
                      <line
                        key={k}
                        className={e.matched ? "ladder-entry" : "ladder-entry-out"}
                        x1={sx(p.key, i, v)}
                        x2={sx(p.key, i, v)}
                        y1={HEAD - 13}
                        y2={HEAD - 5}
                      />
                    );
                  })}
                  {groups[p.key].map((g, row) => {
                    const y = HEAD + row * ROW;
                    const picked = hover?.param === p.key && hover.key === g.key;
                    const marked = !picked && hover && g.modes.some((m) => hoveredModes.has(m.id));
                    const label = `${g.raw ? spanText(g.raw) : "—"} · ${g.modes.length} Mode${g.modes.length === 1 ? "" : "s"}`;
                    return (
                      <g
                        key={g.key}
                        className={`ladder-row${picked ? " hovered" : ""}${hover && !picked && !marked ? " groups-faded" : ""}`}
                        onPointerEnter={() => setHover({ param: p.key, key: g.key })}
                      >
                        <rect className="ladder-row-bg" x={boxX(i) + 1} y={y} width={boxW - 2} height={ROW} />
                        <title>{`${p.label} ${label}${g.eng && g.raw && (g.eng[0] !== g.raw[0] || g.eng[1] !== g.raw[1]) ? ` (engineered ${spanText(g.eng)})` : ""}\n${statusCounts(g.modes)
                          .map((c) => `${c.n} ${RESULT_STATUS[c.k].label.toLowerCase()}`)
                          .join(", ")}\n${namesList(g.modes)}`}</title>
                        <text className="groups-label" x={panelX(i)} y={y + 10}>
                          {label}
                        </text>
                        {g.raw && g.eng ? (
                          <GroupBar
                            x0={sx(p.key, i, g.raw[0])}
                            x1={sx(p.key, i, g.raw[1])}
                            ex0={sx(p.key, i, g.eng[0])}
                            ex1={sx(p.key, i, g.eng[1])}
                            y={y + 14}
                            modes={g.modes}
                            clip={`groups-clip-${p.key}`}
                          />
                        ) : null}
                      </g>
                    );
                  })}
                </g>
              );
            })}
          </svg>
        </div>
      </div>
      <CombinationGrid groups={groups} ranges={ranges} hoveredModes={hoveredModes} onOpen={onOpen} />
    </>
  );
}

/** A range's bar: the engineered reach faint, the set range split by how its
 * Modes last tested, worst on the left. */
function GroupBar({
  x0,
  x1,
  ex0,
  ex1,
  y,
  modes,
  clip,
}: {
  x0: number;
  x1: number;
  ex0: number;
  ex1: number;
  y: number;
  modes: Mode[];
  clip: string;
}) {
  const w = Math.max(3, x1 - x0);
  let at = x0;
  return (
    <g clipPath={`url(#${clip})`}>
      <rect className="ladder-eng status-neutral" x={ex0} y={y} width={Math.max(3, ex1 - ex0)} height={8} rx={2} />
      {statusCounts(modes).map(({ k, n }) => {
        const part = (w * n) / modes.length;
        const rect = <rect key={k} className={`ladder-raw ${RESULT_STATUS[k].cls}`} x={at} y={y} width={part} height={8} />;
        at += part;
        return rect;
      })}
    </g>
  );
}

/** Which combinations of two parameters' ranges the Modes have: a row per
 * range of one, a column per range of the other, one square per Mode in the
 * cell (coloured by its last test result; click to open it). An empty cell is
 * a combination no Mode has. */
function CombinationGrid({
  groups,
  ranges,
  hoveredModes,
  onOpen,
}: {
  groups: Record<ChartParam, Group[]>;
  ranges: ModeRanges[];
  hoveredModes: Set<string>;
  onOpen: (mode: Mode) => void;
}) {
  // By default the two parameters with the most ranges — the third is in each square's tooltip.
  const pairs: [ChartParam, ChartParam][] = [
    ["rf", "pri"],
    ["rf", "pw"],
    ["pri", "pw"],
  ];
  const best = [...pairs].sort((a, b) => groups[b[0]].length * groups[b[1]].length - groups[a[0]].length * groups[a[1]].length)[0];
  const [chosen, setChosen] = useState<string | null>(null);
  const [rowP, colP] = pairs.find((p) => p.join("-") === chosen) ?? best;
  const third = (["rf", "pri", "pw"] as ChartParam[]).find((p) => p !== rowP && p !== colP)!;

  const groupOf = (p: ChartParam) => {
    const map = new Map<string, string>();
    for (const g of groups[p]) for (const m of g.modes) map.set(m.id, g.key);
    return map;
  };
  const rowOf = groupOf(rowP);
  const colOf = groupOf(colP);
  const cells = new Map<string, ModeRanges[]>();
  for (const r of ranges) {
    const k = `${rowOf.get(r.mode.id)}#${colOf.get(r.mode.id)}`;
    cells.set(k, [...(cells.get(k) ?? []), r]);
  }
  const used = cells.size;
  const possible = groups[rowP].length * groups[colP].length;
  const thirdText = (r: ModeRanges) => {
    const s = rawOf(r, third);
    return `${LABEL[third].label.split(" ")[0]} ${s ? `${spanText(s)} ${LABEL[third].unit}` : "—"}`;
  };

  return (
    <div className="viz-card">
      <div className="viz-card-header">
        <strong>Combinations</strong>
        <span className="hint-text">
          {used} of {possible} combination{possible === 1 ? "" : "s"} used ·{" "}
          <select className="ladder-sort" value={`${rowP}-${colP}`} onChange={(e) => setChosen(e.target.value)} aria-label="Which parameters the grid crosses">
            {pairs.map(([a, b]) => (
              <option key={`${a}-${b}`} value={`${a}-${b}`}>
                {LABEL[a].label.split(" ")[0]} × {LABEL[b].label.split(" ")[0]}
              </option>
            ))}
          </select>
        </span>
      </div>
      <div className="combo-grid-wrap">
        <table className="combo-grid">
          <thead>
            <tr>
              <th className="combo-corner">
                {LABEL[rowP].label.split(" ")[0]} ↓ · {LABEL[colP].label.split(" ")[0]} →
              </th>
              {groups[colP].map((g) => (
                <th key={g.key} scope="col">
                  {g.raw ? spanText(g.raw) : "—"}
                  <span className="combo-unit"> {g.raw ? LABEL[colP].unit : ""}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groups[rowP].map((rg) => (
              <tr key={rg.key}>
                <th scope="row">
                  {rg.raw ? spanText(rg.raw) : "—"}
                  <span className="combo-unit"> {rg.raw ? LABEL[rowP].unit : ""}</span>
                </th>
                {groups[colP].map((cg) => {
                  const inCell = (cells.get(`${rg.key}#${cg.key}`) ?? []).sort((a, b) =>
                    a.mode.name.localeCompare(b.mode.name, undefined, { numeric: true }),
                  );
                  return (
                    <td key={cg.key} className={inCell.length ? undefined : "combo-empty"}>
                      {inCell.length === 0 ? (
                        <span aria-label="No Mode">·</span>
                      ) : (
                        <>
                          {inCell.slice(0, CELL_SQUARES).map((r) => (
                            <button
                              key={r.mode.id}
                              type="button"
                              className={`combo-mode viz-swatch ${resultStatus(r.mode).cls}${hoveredModes.has(r.mode.id) ? " marked" : ""}`}
                              title={`${r.mode.name} · ${thirdText(r)} · ${resultStatus(r.mode).label}`}
                              aria-label={`${r.mode.name}, ${thirdText(r)}, ${resultStatus(r.mode).label} — open`}
                              onClick={() => onOpen(r.mode)}
                            />
                          ))}
                          {inCell.length > CELL_SQUARES && <span className="hint-text"> +{inCell.length - CELL_SQUARES}</span>}
                        </>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
