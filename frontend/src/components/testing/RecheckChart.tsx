import { useMemo, useState } from "react";
import type { Mode } from "../../types/domain";
import type { EntryMatch, MatchableEntry } from "../intercepts/interceptMatch";
import { describeMiss } from "../intercepts/interceptMatch";
import { fmt, niceTicks, useWidth } from "../intercepts/charts/Histogram";
import { domainOf, modeRanges, spanOf, type ChartParam, type ModeRanges, type Span } from "../modes/charts/modeRanges";

export type RecheckNow = "match" | "near" | "none" | "unknown";

/** A logged set as the chart draws it. */
export interface RecheckPoint {
  key: string;
  where: string;
  /** Its parameters in words, for the read-out. */
  text: string;
  entry: MatchableEntry;
  match: EntryMatch | null;
  now: RecheckNow;
  /** Today's match differs from what was reported in the test. */
  changed: boolean;
}

const AXES: Record<ChartParam, { short: string; unit: string }> = {
  rf: { short: "RF", unit: "MHz" },
  pri: { short: "PRI / frame time", unit: "µs" },
  pw: { short: "PW", unit: "µs" },
};
const AXES_KEY = "recheckChartAxes";
const HEIGHT = 340;
const M = { left: 60, right: 14, top: 14, bottom: 40 };
// Within this many pixels of the pointer, points are read out together.
const HOVER_PX = 8;

const NOW_LABEL: Record<RecheckNow, string> = {
  match: "Would match",
  near: "Near — one value off",
  none: "No Mode",
  unknown: "Can't compare",
};

function value(e: MatchableEntry, p: ChartParam): number | null {
  return p === "rf" ? e.rf_mean_mhz : p === "pri" ? e.pri_mean_us : e.pw_mean_us;
}

function readAxes(): { x: ChartParam; y: ChartParam } {
  try {
    const v = JSON.parse(localStorage.getItem(AXES_KEY) ?? "null") as { x?: string; y?: string } | null;
    const keys: ChartParam[] = ["rf", "pri", "pw"];
    const x = keys.find((k) => k === v?.x);
    const y = keys.find((k) => k === v?.y);
    if (x && y && x !== y) return { x, y };
  } catch {
    // Unreadable — the default.
  }
  return { x: "rf", y: "pri" };
}

/** A point's mark: a shape per outcome as well as a colour — never colour alone. */
function Mark({ now, x, y, picked, changed }: { now: RecheckNow; x: number; y: number; picked: boolean; changed: boolean }) {
  const r = picked ? 7 : 5;
  const cls = `recheck-mark recheck-mark-${now}`;
  return (
    <g>
      {(changed || picked) && (
        <circle cx={x} cy={y} r={r + 4} className={picked ? "recheck-mark-ring picked" : "recheck-mark-ring"} />
      )}
      {now === "match" && <circle cx={x} cy={y} r={r} className={cls} />}
      {now === "near" && (
        <path d={`M${x},${y - r * 1.2} L${x + r * 1.1},${y + r * 0.8} L${x - r * 1.1},${y + r * 0.8} Z`} className={cls} />
      )}
      {now === "none" && (
        <path
          d={`M${x - r},${y - r} L${x + r},${y + r} M${x + r},${y - r} L${x - r},${y + r}`}
          className={cls}
          strokeWidth={3}
        />
      )}
      {now === "unknown" && <rect x={x - r} y={y - r} width={r * 2} height={r * 2} className={cls} />}
    </g>
  );
}

/** The run's logged sets on two parameters, over the Emitter's Modes as
 * they are now (each its engineered range, the delta on). Coloured and
 * shaped by whether they'd match now; a near miss has a dashed line to the
 * Mode it's close to. Clicking a point picks its row in the table. */
export function RecheckChart({
  points,
  modes,
  picked,
  onPick,
}: {
  points: RecheckPoint[];
  modes: Mode[];
  picked: string | null;
  onPick: (key: string | null) => void;
}) {
  const { ref, width } = useWidth<HTMLDivElement>();
  const [axes, setAxesState] = useState(readAxes);
  const [fitLogged, setFitLogged] = useState(false);
  const [hover, setHover] = useState<{ px: number; py: number } | null>(null);
  const [hoverMode, setHoverMode] = useState<string | null>(null);
  function setAxes(x: ChartParam, y: ChartParam) {
    setAxesState({ x, y });
    try {
      localStorage.setItem(AXES_KEY, JSON.stringify({ x, y }));
    } catch {
      // Not remembered — fine.
    }
  }

  const ranges = useMemo(() => modes.map(modeRanges).filter((r): r is ModeRanges => !!r), [modes]);
  // Modes with a range on both axes (CW has no PRI or PW).
  const boxes = ranges.flatMap((r) => {
    const x = spanOf(r, axes.x);
    const y = spanOf(r, axes.y);
    return x && y ? [{ r, x, y }] : [];
  });
  const placed = points.flatMap((p) => {
    const x = value(p.entry, axes.x);
    const y = value(p.entry, axes.y);
    return x != null && y != null ? [{ p, x, y }] : [];
  });
  const offAxes = points.length - placed.length;

  const xs = placed.map((d) => d.x);
  const ys = placed.map((d) => d.y);
  const xDomain: Span = fitLogged && placed.length ? domainOf([], xs) : domainOf(boxes.map((b) => b.x), xs);
  const yDomain: Span = fitLogged && placed.length ? domainOf([], ys) : domainOf(boxes.map((b) => b.y), ys);

  const plotW = Math.max(10, width - M.left - M.right);
  const plotH = HEIGHT - M.top - M.bottom;
  const sx = (v: number) => M.left + ((v - xDomain[0]) / (xDomain[1] - xDomain[0] || 1)) * plotW;
  const sy = (v: number) => M.top + plotH - ((v - yDomain[0]) / (yDomain[1] - yDomain[0] || 1)) * plotH;
  const clampX = (v: number) => Math.min(M.left + plotW, Math.max(M.left, v));
  const clampY = (v: number) => Math.min(M.top + plotH, Math.max(M.top, v));

  const near = (d: (typeof placed)[number]) => hover && Math.hypot(sx(d.x) - hover.px, sy(d.y) - hover.py) <= HOVER_PX;
  const hovered = hover ? placed.filter(near) : [];
  const boxOf = new Map(boxes.map((b) => [b.r.mode.id, b]));

  const axisSelect = (label: string, current: ChartParam, other: ChartParam, set: (p: ChartParam) => void) => (
    <label className="inline-label">
      {label}
      <select value={current} onChange={(e) => set(e.target.value as ChartParam)}>
        {(Object.keys(AXES) as ChartParam[]).map((p) => (
          <option key={p} value={p} disabled={p === other}>
            {AXES[p].short}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <div className="recheck-chart">
      <div className="chart-controls-row">
        {axisSelect("Across", axes.x, axes.y, (x) => setAxes(x, axes.y))}
        {axisSelect("Up", axes.y, axes.x, (y) => setAxes(axes.x, y))}
        <button type="button" className="link-button" onClick={() => setAxes(axes.y, axes.x)} title="Swap the axes">
          ⇄ Swap
        </button>
        <label className="inline-label">
          <input type="checkbox" checked={fitLogged} onChange={(e) => setFitLogged(e.target.checked)} />
          Zoom to the logged values
        </label>
        <span className="hint-text">
          {boxes.length} Mode{boxes.length === 1 ? "" : "s"} drawn
          {ranges.length > boxes.length && ` (${ranges.length - boxes.length} without ${AXES[axes.x].short} and ${AXES[axes.y].short})`}
          {offAxes > 0 && ` · ${offAxes} set${offAxes === 1 ? "" : "s"} without both values not shown`}
        </span>
      </div>
      <div ref={ref} className="recheck-chart-plot">
        {width > 0 && (
          <svg
            width={width}
            height={HEIGHT}
            role="img"
            aria-label={`Logged values by ${AXES[axes.x].short} and ${AXES[axes.y].short} over the Modes`}
            onPointerMove={(e) => {
              const box = e.currentTarget.getBoundingClientRect();
              setHover({ px: e.clientX - box.left, py: e.clientY - box.top });
            }}
            onPointerLeave={() => {
              setHover(null);
              setHoverMode(null);
            }}
            onClick={() => onPick(hovered[0]?.p.key ?? null)}
          >
            <defs>
              <clipPath id="recheck-plot-clip">
                <rect x={M.left} y={M.top} width={plotW} height={plotH} />
              </clipPath>
            </defs>
            {niceTicks(...xDomain).map((t) => (
              <g key={`x${t}`}>
                <line x1={sx(t)} x2={sx(t)} y1={M.top} y2={M.top + plotH} className="viz-grid" />
                <text x={sx(t)} y={M.top + plotH + 14} textAnchor="middle" className="viz-axis-label">
                  {fmt(t)}
                </text>
              </g>
            ))}
            {niceTicks(...yDomain).map((t) => (
              <g key={`y${t}`}>
                <line x1={M.left} x2={M.left + plotW} y1={sy(t)} y2={sy(t)} className="viz-grid" />
                <text x={M.left - 6} y={sy(t) + 4} textAnchor="end" className="viz-axis-label">
                  {fmt(t)}
                </text>
              </g>
            ))}
            <text x={M.left + plotW / 2} y={HEIGHT - 4} textAnchor="middle" className="viz-axis-label recheck-axis-title">
              {AXES[axes.x].short} ({AXES[axes.x].unit})
            </text>
            <text transform={`translate(12 ${M.top + plotH / 2}) rotate(-90)`} textAnchor="middle" className="viz-axis-label recheck-axis-title">
              {AXES[axes.y].short} ({AXES[axes.y].unit})
            </text>
            <g clipPath="url(#recheck-plot-clip)">
              {boxes.map(({ r, x, y }) => {
                const x0 = sx(x[0]);
                const y0 = sy(y[1]);
                const w = Math.max(3, sx(x[1]) - x0);
                const h = Math.max(3, sy(y[0]) - y0);
                const hot = hoverMode === r.mode.id;
                return (
                  <g key={r.mode.id} onPointerEnter={() => setHoverMode(r.mode.id)} onPointerLeave={() => setHoverMode(null)}>
                    <rect x={x0} y={y0} width={w} height={h} className={hot ? "recheck-mode-box hot" : "recheck-mode-box"}>
                      <title>
                        {`${r.mode.name}: ${AXES[axes.x].short} ${fmt(x[0])}–${fmt(x[1])} ${AXES[axes.x].unit}, ${AXES[axes.y].short} ${fmt(y[0])}–${fmt(y[1])} ${AXES[axes.y].unit}`}
                      </title>
                    </rect>
                    {w > 40 && (
                      // Inside the box's top, or just above a box too thin for it.
                      <text x={x0 + 4} y={h > 14 ? y0 + 12 : y0 - 3} className="recheck-mode-label">
                        {r.mode.name}
                      </text>
                    )}
                  </g>
                );
              })}
              {/* A near miss: dashed to the nearest edge of the Mode it's close to. */}
              {placed.map(({ p, x, y }) => {
                const target = p.now === "near" ? p.match?.near[0] : undefined;
                const b = target && boxOf.get(target.mode.id);
                if (!b) return null;
                const tx = Math.min(Math.max(x, b.x[0]), b.x[1]);
                const ty = Math.min(Math.max(y, b.y[0]), b.y[1]);
                if (tx === x && ty === y) return null;
                return (
                  <line key={`n-${p.key}`} x1={sx(x)} y1={sy(y)} x2={clampX(sx(tx))} y2={clampY(sy(ty))} className="recheck-near-line" />
                );
              })}
              {placed.map(({ p, x, y }) => (
                <Mark key={p.key} now={p.now} x={sx(x)} y={sy(y)} picked={picked === p.key} changed={p.changed} />
              ))}
            </g>
          </svg>
        )}
        {hovered.length > 0 && hover && (
          <div
            className="recheck-chart-tip"
            style={{ left: Math.min(hover.px + 14, Math.max(0, width - 300)), top: Math.min(hover.py + 14, HEIGHT - 40) }}
          >
            {hovered.slice(0, 4).map(({ p }) => (
              <div key={p.key}>
                <strong>{p.where}</strong>
                <div className="hint-text">{p.text}</div>
                <div>
                  {NOW_LABEL[p.now]}
                  {p.match?.matches.length ? `: ${p.match.matches.map((m) => m.name).join(", ")}` : ""}
                  {p.now === "near" && p.match?.near[0] && (
                    <>
                      {" "}
                      — {p.match.near[0].mode.name}: {p.match.near[0].misses.map(describeMiss).join("; ")}
                    </>
                  )}
                  {p.changed && <span className="hint-text"> · differs from what was reported</span>}
                </div>
              </div>
            ))}
            {hovered.length > 4 && <div className="hint-text">and {hovered.length - 4} more here</div>}
            <div className="hint-text">Click to pick it out in the table</div>
          </div>
        )}
      </div>
      <div className="viz-legend recheck-chart-legend">
        <span>
          <svg width="16" height="14" aria-hidden>
            <circle cx="8" cy="7" r="5" className="recheck-mark recheck-mark-match" />
          </svg>{" "}
          Would match
        </span>
        <span>
          <svg width="16" height="14" aria-hidden>
            <path d="M8,1 L13.5,11 L2.5,11 Z" className="recheck-mark recheck-mark-near" />
          </svg>{" "}
          Near (dashed to the Mode)
        </span>
        <span>
          <svg width="16" height="14" aria-hidden>
            <path d="M3,2 L13,12 M13,2 L3,12" className="recheck-mark recheck-mark-none" strokeWidth={3} />
          </svg>{" "}
          No Mode
        </span>
        <span>
          <svg width="20" height="18" aria-hidden>
            <circle cx="10" cy="9" r="8" className="recheck-mark-ring" />
          </svg>{" "}
          Differs from what was reported
        </span>
        <span>
          <span className="viz-swatch recheck-mode-swatch" /> A Mode now (its range with the delta)
        </span>
      </div>
      <p className="hint-text recheck-chart-note">
        A point inside a Mode&apos;s box can still miss it on the parameter not drawn, its jitter or a stagger&apos;s
        steps — hover for why.
      </p>
    </div>
  );
}
