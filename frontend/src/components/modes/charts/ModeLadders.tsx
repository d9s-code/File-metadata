import { useMemo, useState } from "react";
import { fmt, niceTicks, useWidth } from "../../intercepts/charts/Histogram";
import {
  domainOf,
  resultStatus,
  withLimits,
  type AxisLimits,
  type ModeRanges,
  type Paint,
  type Span,
} from "./modeRanges";
import type { Mode } from "../../../types/domain";
import type { MapEntry } from "./ModeMap";

const ROW = 20;
const HEAD = 54;
const NAME_W = 200;
// Each parameter sits in its own box: space between the boxes, padding inside.
const GAP = 26;
const PAD = 12;

type SortBy = "rf" | "pri" | "pw" | "name";
type Param = "rf" | "pri" | "pw";
const PARAMS: { key: Param; label: string; unit: string }[] = [
  { key: "rf", label: "RF", unit: "MHz" },
  { key: "pri", label: "PRI / frame time", unit: "µs" },
  { key: "pw", label: "PW", unit: "µs" },
];

function rawOf(r: ModeRanges, p: Param): Span | null {
  return p === "rf" ? r.rfRaw : p === "pri" ? r.priRaw : r.pwRaw;
}
function engOf(r: ModeRanges, p: Param): Span | null {
  return p === "rf" ? r.rf : p === "pri" ? r.pri : r.pw;
}

function truncate(s: string, n: number) {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

/** One row per Mode, its RF, PRI (frame time for a stagger) and PW ranges side
 * by side: the solid bar is what the Mode was set to, the faint extension is
 * what the system recognises (± delta). Bars that line up in a column
 * overlap on that parameter; gaps between them are values no Mode covers.
 * Intercept entries are ticks along the top of each column. A column fits
 * the Modes unless the user set its bounds; a Mode reaching past them is cut
 * at the edge, and one wholly beyond them gets an arrow pointing its way. */
export function ModeLadders({
  ranges,
  entries,
  fitEntries,
  limits,
  paint,
  highlight,
  onOpen,
}: {
  ranges: ModeRanges[];
  entries: MapEntry[];
  fitEntries: boolean;
  limits: AxisLimits;
  paint: Paint;
  highlight: string | null;
  onOpen: (mode: Mode) => void;
}) {
  const { ref, width } = useWidth<HTMLDivElement>();
  const [sortBy, setSortBy] = useState<SortBy>("rf");
  const [hoverRow, setHoverRow] = useState<number | null>(null);

  const rows = useMemo(() => {
    const key = (r: ModeRanges) =>
      sortBy === "name" ? 0 : (engOf(r, sortBy)?.[0] ?? Infinity);
    return [...ranges].sort(
      (a, b) => key(a) - key(b) || a.mode.name.localeCompare(b.mode.name),
    );
  }, [ranges, sortBy]);

  const domains = useMemo(() => {
    const entryValues = (p: Param) =>
      p === "rf"
        ? entries.map((e) => e.rf)
        : p === "pri"
          ? entries.flatMap((e) => (e.pri == null ? [] : [e.pri]))
          : [];
    return Object.fromEntries(
      PARAMS.map(({ key }) => [
        key,
        withLimits(
          domainOf(
            ranges.map((r) => engOf(r, key)),
            fitEntries ? entryValues(key) : [],
          ),
          limits[key],
        ),
      ]),
    ) as Record<Param, Span>;
  }, [ranges, entries, fitEntries, limits]);

  const panelW = Math.max(
    60,
    (width - NAME_W - (GAP + 2 * PAD) * PARAMS.length) / PARAMS.length,
  );
  const panelX = (i: number) =>
    NAME_W + GAP + PAD + i * (panelW + 2 * PAD + GAP);
  const boxX = (i: number) => panelX(i) - PAD;
  const boxW = panelW + 2 * PAD;
  const height = HEAD + rows.length * ROW + 6;
  const sx = (p: Param, i: number, v: number) => {
    const [lo, hi] = domains[p];
    return panelX(i) + ((v - lo) / (hi - lo || 1)) * panelW;
  };

  return (
    <div className="viz-card">
      <div className="viz-card-header">
        <strong>Range ladders</strong>
        <span className="hint-text">
          Sort by{" "}
          <select
            className="ladder-sort"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortBy)}
          >
            <option value="rf">RF</option>
            <option value="pri">PRI / frame time</option>
            <option value="pw">PW</option>
            <option value="name">Name</option>
          </select>
        </span>
      </div>
      <div
        ref={ref}
        className="viz-plot"
        onPointerLeave={() => setHoverRow(null)}
      >
        <svg
          width={width}
          height={height}
          aria-label="Mode ranges per parameter"
        >
          <defs>
            {PARAMS.map((p, i) => (
              <clipPath key={p.key} id={`ladder-clip-${p.key}`}>
                <rect x={panelX(i) - 1} y={0} width={panelW + 2} height={height} />
              </clipPath>
            ))}
          </defs>
          {PARAMS.map((p, i) => (
            <rect
              key={`box-${p.key}`}
              className="ladder-panel"
              x={boxX(i)}
              y={1}
              width={boxW}
              height={height - 2}
              rx={6}
            />
          ))}
          {PARAMS.map((p, i) => {
            const [lo, hi] = domains[p.key];
            const x0 = panelX(i);
            return (
              <g key={p.key}>
                <text className="ladder-title" x={x0} y={17}>
                  {p.label}
                  <tspan className="ladder-title-unit"> {p.unit}</tspan>
                </text>
                <line
                  className="ladder-panel-rule"
                  x1={boxX(i)}
                  x2={boxX(i) + boxW}
                  y1={HEAD - 2}
                  y2={HEAD - 2}
                />
                {niceTicks(lo, hi, 4).map((t) => (
                  <g key={t}>
                    <line
                      className="viz-grid"
                      x1={sx(p.key, i, t)}
                      x2={sx(p.key, i, t)}
                      y1={HEAD - 2}
                      y2={height - 6}
                    />
                    <text
                      className="viz-axis-label"
                      x={sx(p.key, i, t)}
                      y={33}
                      textAnchor="middle"
                    >
                      {fmt(t)}
                    </text>
                  </g>
                ))}
                {entries.map((e, k) => {
                  const v =
                    p.key === "rf" ? e.rf : p.key === "pri" ? e.pri : e.pw;
                  // Off this column's axis: left out rather than drawn over the next column.
                  if (v == null || v < lo || v > hi) return null;
                  return (
                    <line
                      key={k}
                      className={
                        e.matched ? "ladder-entry" : "ladder-entry-out"
                      }
                      x1={sx(p.key, i, v)}
                      x2={sx(p.key, i, v)}
                      y1={HEAD - 13}
                      y2={HEAD - 5}
                    />
                  );
                })}
              </g>
            );
          })}
          {rows.map((r, rowIndex) => {
            const y = HEAD + rowIndex * ROW;
            const status = resultStatus(r.mode);
            const colour = paint(r.mode).cls;
            const faded = highlight && highlight !== r.mode.id;
            return (
              <g
                key={r.mode.id}
                className={`ladder-row${hoverRow === rowIndex ? " hovered" : ""}${faded ? " dimmed" : ""}`}
                onPointerEnter={() => setHoverRow(rowIndex)}
              >
                {/* Highlighted per region, so the boxes stay distinct. */}
                <rect
                  className="ladder-row-bg"
                  x={0}
                  y={y}
                  width={NAME_W}
                  height={ROW}
                />
                {PARAMS.map((p, i) => (
                  <rect
                    key={p.key}
                    className="ladder-row-bg"
                    x={boxX(i) + 1}
                    y={y}
                    width={boxW - 2}
                    height={ROW}
                  />
                ))}
                <title>
                  {`${r.mode.name} · ${status.label}\nRF ${fmt(r.rfRaw[0])}–${fmt(r.rfRaw[1])} (engineered ${fmt(r.rf[0])}–${fmt(r.rf[1])}) MHz`}
                  {r.priRaw && r.pri
                    ? `\nPRI ${fmt(r.priRaw[0])}–${fmt(r.priRaw[1])} (engineered ${fmt(r.pri[0])}–${fmt(r.pri[1])}) µs`
                    : ""}
                  {r.pwRaw && r.pw
                    ? `\nPW ${fmt(r.pwRaw[0])}–${fmt(r.pwRaw[1])} (engineered ${fmt(r.pw[0])}–${fmt(r.pw[1])}) µs`
                    : ""}
                </title>
                <rect
                  className={`ladder-dot ${colour}`}
                  x={2}
                  y={y + ROW / 2 - 4}
                  width={8}
                  height={8}
                  rx={2}
                />
                <text
                  className="ladder-name"
                  x={16}
                  y={y + ROW / 2 + 4}
                  onClick={() => onOpen(r.mode)}
                >
                  {truncate(r.mode.name, 26)}
                </text>
                {PARAMS.map((p, i) => {
                  const eng = engOf(r, p.key);
                  const raw = rawOf(r, p.key);
                  if (!eng || !raw) {
                    return (
                      <text
                        key={p.key}
                        className="viz-axis-label"
                        x={panelX(i)}
                        y={y + ROW / 2 + 4}
                      >
                        —
                      </text>
                    );
                  }
                  const [lo, hi] = domains[p.key];
                  if (eng[1] < lo || eng[0] > hi) {
                    const left = eng[1] < lo;
                    return (
                      <text
                        key={p.key}
                        className="ladder-beyond"
                        x={left ? panelX(i) : panelX(i) + panelW}
                        y={y + ROW / 2 + 4}
                        textAnchor={left ? "start" : "end"}
                      >
                        {left ? `◂ ${fmt(eng[1])}` : `${fmt(eng[0])} ▸`}
                      </text>
                    );
                  }
                  const ex = sx(p.key, i, eng[0]);
                  const rx = sx(p.key, i, raw[0]);
                  return (
                    <g key={p.key} clipPath={`url(#ladder-clip-${p.key})`}>
                      <rect
                        className={`ladder-eng ${colour}`}
                        x={ex}
                        y={y + ROW / 2 - 4}
                        width={Math.max(3, sx(p.key, i, eng[1]) - ex)}
                        height={8}
                        rx={2}
                      />
                      <rect
                        className={`ladder-raw ${colour}`}
                        x={rx}
                        y={y + ROW / 2 - 4}
                        width={Math.max(3, sx(p.key, i, raw[1]) - rx)}
                        height={8}
                        rx={2}
                      />
                    </g>
                  );
                })}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
