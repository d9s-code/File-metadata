import { useMemo, useState } from "react";
import type { CsvReport, ReportPriType } from "../interceptCsv";
import { missionTimeMs } from "../interceptCsv";
import { formatTime, timeTicks } from "./timeAxis";
import { reportKind, type ReportGroup } from "../interceptGroups";
import { matchEntry } from "../interceptMatch";
import type { Mode } from "../../../types/domain";
import {
  allIntervals,
  inIntervals,
  modeCoverage,
  reportValues,
  type ChartParam,
} from "./coverage";
import { Histogram } from "./Histogram";
import { Scatter, type ScatterBox, type ScatterPoint } from "./Scatter";

export type RangeParam = "rf" | "pri" | "pw";
export type Range = [number, number] | null;

const AXIS_INFO: Record<RangeParam, { short: string; unit: string }> = {
  rf: { short: "RF", unit: "MHz" },
  pri: { short: "PRI", unit: "µs" },
  pw: { short: "PW", unit: "µs" },
};
const AXES_KEY = "importScatterAxes";
const BOXES_KEY = "importScatterBoxes";
type BoxSource = "preview" | "groups" | "none";
// Beyond this many, outlines would hide the points rather than show the groups.
const MAX_BOXES = 3000;

function readAxes(): { x: RangeParam; y: RangeParam } {
  try {
    const stored = JSON.parse(localStorage.getItem(AXES_KEY) ?? "null") as {
      x?: string;
      y?: string;
    } | null;
    const keys: RangeParam[] = ["rf", "pri", "pw"];
    const x = keys.find((k) => k === stored?.x);
    const y = keys.find((k) => k === stored?.y);
    if (x && y && x !== y) return { x, y };
  } catch {
    // Unreadable — use the default.
  }
  return { x: "rf", y: "pri" };
}

/** A report's value on a scatter axis — PRI is a stagger's frame time, none for CW. */
function axisValue(r: CsvReport, p: RangeParam): number | null {
  return p === "rf" ? r.rfMhz : p === "pri" ? r.priUs : r.pwUs;
}

export interface ChartFilters {
  type: "" | ReportPriType;
  track: string;
  identified: string;
  rf: Range;
  pri: Range;
  pw: Range;
}

const CHARTS: {
  param: ChartParam;
  label: string;
  unit: string;
  filter?: RangeParam;
}[] = [
  { param: "rf", label: "RF", unit: "MHz", filter: "rf" },
  { param: "pri", label: "PRI — fixed", unit: "µs", filter: "pri" },
  { param: "frame", label: "Frame time — stagger", unit: "µs", filter: "pri" },
  { param: "pw", label: "PW", unit: "µs", filter: "pw" },
  { param: "jitter", label: "Jitter — fixed", unit: "µs" },
  { param: "stagger", label: "Stagger positions", unit: "µs" },
];

function fmtValue(v: number) {
  return Number(v.toFixed(3)).toLocaleString(undefined, { maximumFractionDigits: 3 });
}

function kindLabel(kind: string) {
  if (kind === "fixed") return "fixed";
  if (kind === "cw") return "CW";
  return `stagger (${kind.split("/")[1]} positions)`;
}

function within(v: number | null, r: Range) {
  return r == null || (v != null && v >= r[0] && v <= r[1]);
}

/** A chart's range: its own filter where that's closed, the data where it's
 * open-ended (only a minimum or maximum typed). */
function zoom(own: Range, values: number[]): [number, number] {
  const [lo, hi] = extent(values);
  if (!own) return [lo, hi];
  return [
    Number.isFinite(own[0]) ? own[0] : lo,
    Number.isFinite(own[1]) ? own[1] : hi,
  ];
}

function extent(values: number[]): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of values) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (!Number.isFinite(lo)) return [0, 1];
  if (lo === hi)
    return [
      lo - Math.max(Math.abs(lo) * 0.001, 0.5),
      hi + Math.max(Math.abs(hi) * 0.001, 0.5),
    ];
  const pad = (hi - lo) * 0.02;
  return [lo - pad, hi + pad];
}

/** The import's charts: one distribution per parameter, split by whether the
 * reports fall within the Emitter's Modes, and RF against PRI. Each chart
 * shows the reports that pass every filter except its own, and zooms to its
 * own range when one is set — so selecting an RF clump shows that clump's
 * PRI and PW spread. Excluded reports aren't shown. */
export function ImportCharts({
  reports,
  excludedLines,
  modes,
  filters,
  onRange,
  onBox,
  preview,
  groups,
  onlyLines = null,
  split = null,
  onSplitPick,
  showDistributions = true,
  showTime = false,
  onGroupLines,
}: {
  /** Make groups of the reports marked on the time charts. */
  onGroupLines?: (lines: number[]) => void;
  /** The scatter and the per-parameter distributions. */
  showDistributions?: boolean;
  /** RF, PRI and PW against time. */
  showTime?: boolean;
  reports: CsvReport[];
  excludedLines: Set<number>;
  modes: Mode[] | undefined;
  filters: ChartFilters;
  onRange: (param: RangeParam, range: Range) => void;
  /** A box dragged on the scatter: a range on each of its two parameters. */
  onBox: (x: RangeParam, xRange: Range, y: RangeParam, yRange: Range) => void;
  /** Auto group's preview with the current settings — drawn as ticks, and as boxes on the scatter. */
  preview: ReportGroup[] | null;
  /** The groups as they are now — the scatter can outline these instead. */
  groups: ReportGroup[];
  /** Show just these reports (the rows being split). */
  onlyLines?: Set<number> | null;
  /** A split about to be made, drawn on its charts. */
  split?: { param: RangeParam; value: number } | null;
  /** Given while splitting: a click on the RF, PRI or PW chart picks the value. */
  onSplitPick?: (param: RangeParam, value: number) => void;
}) {
  const coverage = useMemo(
    () => (modes && modes.length > 0 ? modeCoverage(modes) : null),
    [modes],
  );

  // Reports passing the filters that aren't value ranges.
  const base = useMemo(() => {
    const track = filters.track.trim();
    return reports.filter(
      (r) =>
        (onlyLines ? onlyLines.has(r.line) : !excludedLines.has(r.line)) &&
        (!filters.type || r.priType === filters.type) &&
        (!track || r.track === track) &&
        (!filters.identified ||
          (r.designation ?? "not identified") === filters.identified),
    );
  }, [reports, excludedLines, onlyLines, filters.type, filters.track, filters.identified]);

  // The ranges arrive as new arrays on every render; key the work on their values.
  const rangesKey = JSON.stringify([filters.rf, filters.pri, filters.pw]);
  const ranges = useMemo(
    () => ({ rf: filters.rf, pri: filters.pri, pw: filters.pw }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rangesKey],
  );
  const passes = (r: CsvReport, except: RangeParam | null) =>
    (except === "rf" || within(r.rfMhz, ranges.rf)) &&
    (except === "pri" || within(r.priUs, ranges.pri)) &&
    (except === "pw" || within(r.pwUs, ranges.pw));

  // Matched against a Mode on RF, PRI and PW — for the scatter and the summary.
  const matchedByLine = useMemo(() => {
    const out = new Map<number, boolean>();
    if (!modes || modes.length === 0) return out;
    for (const r of base) {
      const m = matchEntry(
        {
          pri_type: r.priType,
          rf_mean_mhz: r.rfMhz,
          pri_mean_us: r.priUs,
          pw_mean_us: r.pwUs,
          stagger_values: r.staggerUs,
        },
        modes,
      );
      out.set(r.line, m.status === "match");
    }
    return out;
  }, [base, modes]);

  // Where each preview group would sit, per parameter.
  const previewMarks = useMemo(() => {
    const marks: Record<ChartParam, number[]> = {
      rf: [],
      pri: [],
      frame: [],
      pw: [],
      jitter: [],
      stagger: [],
    };
    if (!preview) return marks;
    const byLine = new Map(reports.map((r) => [r.line, r]));
    for (const g of preview) {
      const rs = g.lines.map((l) => byLine.get(l)!).filter(Boolean);
      if (rs.length === 0) continue;
      for (const param of ["rf", "pri", "frame", "pw"] as ChartParam[]) {
        const vs = rs.flatMap((r) => reportValues(r, param));
        if (vs.length)
          marks[param].push(vs.reduce((a, b) => a + b, 0) / vs.length);
      }
    }
    return marks;
  }, [preview, reports]);

  const charts = useMemo(
    () =>
      CHARTS.map((c) => {
        const rows = base.filter((r) => passes(r, c.filter ?? null));
        const own = c.filter ? ranges[c.filter] : null;
        const values: number[] = [];
        const covered: boolean[] = [];
        for (const r of rows) {
          const intervals = coverage?.[c.param][r.priType] ?? [];
          for (const v of reportValues(r, c.param)) {
            if (own && (v < own[0] || v > own[1])) continue;
            values.push(v);
            covered.push(inIntervals(intervals, v));
          }
        }
        return {
          ...c,
          values,
          covered: coverage && c.param !== "stagger" ? covered : null,
          intervals: coverage ? allIntervals(coverage[c.param]) : [],
          domain: zoom(own, values),
        };
      }),
    // passes reads ranges.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [base, ranges, coverage],
  );

  // Which two parameters the scatter shows — remembered in this browser.
  const [axes, setAxesState] = useState(readAxes);
  function setAxes(x: RangeParam, y: RangeParam) {
    setAxesState({ x, y });
    try {
      localStorage.setItem(AXES_KEY, JSON.stringify({ x, y }));
    } catch {
      // Not remembered — fine.
    }
  }

  const { points, inViewCount, matchedInView, xExtent, yExtent } =
    useMemo(() => {
      const inView = base.filter((r) => passes(r, null));
      const scatterRows = inView.filter(
        (r) => axisValue(r, axes.x) != null && axisValue(r, axes.y) != null,
      );
      return {
        points: scatterRows.map(
          (r): ScatterPoint => ({
            x: axisValue(r, axes.x)!,
            y: axisValue(r, axes.y)!,
            matched:
              modes && modes.length > 0
                ? (matchedByLine.get(r.line) ?? false)
                : null,
          }),
        ),
        inViewCount: inView.length,
        matchedInView: inView.filter((r) => matchedByLine.get(r.line)).length,
        xExtent: zoom(
          ranges[axes.x],
          scatterRows.map((r) => axisValue(r, axes.x)!),
        ),
        yExtent: zoom(
          ranges[axes.y],
          scatterRows.map((r) => axisValue(r, axes.y)!),
        ),
      };
      // passes reads ranges.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [base, ranges, modes, matchedByLine, axes]);

  // Which groups the scatter outlines — remembered in this browser.
  const [boxSource, setBoxSourceState] = useState<BoxSource>(() => {
    try {
      const v = localStorage.getItem(BOXES_KEY);
      return v === "groups" || v === "none" ? v : "preview";
    } catch {
      return "preview";
    }
  });
  function setBoxSource(v: BoxSource) {
    setBoxSourceState(v);
    try {
      localStorage.setItem(BOXES_KEY, v);
    } catch {
      // Not remembered — fine.
    }
  }
  const boxes = useMemo(() => {
    const source = boxSource === "preview" ? preview : boxSource === "groups" ? groups.filter((g) => !g.excluded) : null;
    if (!source) return [];
    const byLine = new Map(reports.map((r) => [r.line, r]));
    const out: ScatterBox[] = [];
    for (const g of source) {
      // A single report is a point, not a group.
      if (g.lines.length < 2) continue;
      if (onlyLines && !onlyLines.has(g.lines[0])) continue;
      let x0 = Infinity;
      let x1 = -Infinity;
      let y0 = Infinity;
      let y1 = -Infinity;
      for (const l of g.lines) {
        const r = byLine.get(l);
        const vx = r && axisValue(r, axes.x);
        const vy = r && axisValue(r, axes.y);
        if (vx == null || vy == null) continue;
        if (vx < x0) x0 = vx;
        if (vx > x1) x1 = vx;
        if (vy < y0) y0 = vy;
        if (vy > y1) y1 = vy;
      }
      if (Number.isFinite(x0)) out.push({ x: [x0, x1], y: [y0, y1], count: g.lines.length });
    }
    return out;
  }, [boxSource, preview, groups, reports, axes, onlyLines]);

  // Boxes marked on the time charts: a time span and a range of one parameter.
  // The first box marks what's in it; later ones add to it (Shift) or narrow it to what's inside (Ctrl/Alt).
  type Mark = { param: RangeParam; x: [number, number]; y: [number, number]; op: "add" | "narrow" };
  const [marks, setMarks] = useState<Mark[]>([]);
  const times = useMemo(() => {
    const out = new Map<number, number>();
    if (!showTime) return out;
    for (const r of base) {
      const t = missionTimeMs(r.missionTime);
      if (t != null) out.set(r.line, t);
    }
    return out;
  }, [showTime, base]);
  // Reports inside any marked box — on that box's chart, so marking a stretch of
  // RF marks those reports, and their PRI and PW light up on the other charts.
  const marked = useMemo(() => {
    const out = new Set<number>();
    if (marks.length === 0) return out;
    const inside = (r: CsvReport, m: Mark) => {
      const t = times.get(r.line);
      const v = axisValue(r, m.param);
      return t != null && v != null && t >= m.x[0] && t <= m.x[1] && v >= m.y[0] && v <= m.y[1];
    };
    for (const r of base) {
      let on = false;
      for (const m of marks) {
        if (m.op === "add") on = on || inside(r, m);
        else on = on && inside(r, m);
      }
      if (on) out.add(r.line);
    }
    return out;
  }, [marks, base, times]);
  const markedSummary = useMemo(() => {
    if (marked.size === 0) return null;
    const kinds = new Map<string, number>();
    const span = { rf: [Infinity, -Infinity], pri: [Infinity, -Infinity], pw: [Infinity, -Infinity] } as Record<
      RangeParam,
      [number, number]
    >;
    for (const r of base) {
      if (!marked.has(r.line)) continue;
      const k = reportKind(r);
      kinds.set(k, (kinds.get(k) ?? 0) + 1);
      for (const p of ["rf", "pri", "pw"] as RangeParam[]) {
        const v = axisValue(r, p);
        if (v == null) continue;
        if (v < span[p][0]) span[p][0] = v;
        if (v > span[p][1]) span[p][1] = v;
      }
    }
    return { kinds, span };
  }, [marked, base]);

  // RF, PRI and PW against time: each chart filtered like its histogram, all on one time axis.
  const timeCharts = useMemo(() => {
    if (!showTime) return null;
    const inView = base.filter((r) => passes(r, null));
    const xDomain = extent(inView.flatMap((r) => (times.has(r.line) ? [times.get(r.line)!] : [])));
    const noTime = inView.filter((r) => !times.has(r.line)).length;
    const charts = (["rf", "pri", "pw"] as RangeParam[]).map((param) => {
      const pts: ScatterPoint[] = [];
      for (const r of base) {
        const t = times.get(r.line);
        const v = axisValue(r, param);
        if (t == null || v == null || !passes(r, param)) continue;
        const own = ranges[param];
        if (own && (v < own[0] || v > own[1])) continue;
        pts.push({
          x: t,
          y: v,
          matched: modes && modes.length > 0 ? (matchedByLine.get(r.line) ?? false) : null,
          marked: marked.has(r.line),
        });
      }
      return { param, points: pts, yDomain: zoom(ranges[param], pts.map((p) => p.y)) };
    });
    return { charts, xDomain, noTime };
    // passes reads ranges.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showTime, base, ranges, modes, matchedByLine, times, marked]);

  const axisSelect = (
    value: RangeParam,
    other: RangeParam,
    set: (p: RangeParam) => void,
    label: string,
  ) => (
    <label className="inline-label map-axis">
      {label}
      <select value={value} onChange={(e) => set(e.target.value as RangeParam)}>
        {(Object.keys(AXIS_INFO) as RangeParam[]).map((p) => (
          <option key={p} value={p} disabled={p === other}>
            {AXIS_INFO[p].short}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <div className="import-charts">
      <div className="viz-summary">
        <span>
          <strong>{inViewCount.toLocaleString()}</strong> report
          {inViewCount === 1 ? "" : "s"} in view
          {coverage && (
            <>
              {" · "}
              <span className="viz-out-text">
                <strong>
                  {(inViewCount - matchedInView).toLocaleString()}
                </strong>{" "}
                don&apos;t match any Mode
              </span>{" "}
              on RF, PRI and PW together
            </>
          )}
          {!coverage && (
            <span className="hint-text">
              {" "}
              · choose an Emitter with Modes to see what they cover
            </span>
          )}
        </span>
        {coverage && (
          <span className="viz-legend">
            <span>
              <span className="viz-swatch viz-in" /> Within a Mode
            </span>
            <span>
              <span className="viz-swatch viz-out" /> Outside every Mode
            </span>
            {showDistributions && (
              <span>
                <span className="viz-swatch viz-coverage" /> Where the Modes
                reach
              </span>
            )}
            {showDistributions && preview && (
              <span>
                <span className="viz-swatch viz-marks-swatch" /> Auto group
                preview
              </span>
            )}
            {showDistributions && boxSource !== "none" && boxes.length > 0 && (
              <span>
                <span
                  className={
                    boxSource === "preview"
                      ? "viz-swatch viz-groupbox-swatch dashed"
                      : "viz-swatch viz-groupbox-swatch"
                  }
                />{" "}
                {boxSource === "preview" ? "Preview group" : "Group"}
              </span>
            )}
          </span>
        )}
      </div>
      {showDistributions && (
        <>
        <Scatter
          header={
            <span className="map-axes">
              <strong>Scatter</strong>
              {axisSelect(axes.x, axes.y, (x) => setAxes(x, axes.y), "Across")}
              {axisSelect(axes.y, axes.x, (y) => setAxes(axes.x, y), "Up")}
              <button
                type="button"
                className="link-button"
                onClick={() => setAxes(axes.y, axes.x)}
                title="Swap the axes"
              >
                ⇄ Swap
              </button>
              <label className="inline-label map-axis">
                Outline
                <select
                  value={boxSource}
                  onChange={(e) => setBoxSource(e.target.value as BoxSource)}
                >
                  <option value="preview">Auto group preview</option>
                  <option value="groups">Groups as they are</option>
                  <option value="none">Nothing</option>
                </select>
              </label>
              <span className="hint-text">
                PRI is a stagger&apos;s frame time
                {boxes.length > MAX_BOXES &&
                  ` · ${boxes.length.toLocaleString()} groups — too many to outline; filter to a range`}
              </span>
            </span>
          }
          boxes={boxes.length > MAX_BOXES ? [] : boxes}
          boxStyle={boxSource === "preview" ? "dashed" : "solid"}
          xAxis={AXIS_INFO[axes.x]}
          yAxis={AXIS_INFO[axes.y]}
          points={points}
          xDomain={xExtent}
          yDomain={yExtent}
          selection={
            ranges[axes.x] && ranges[axes.y]
              ? { x: ranges[axes.x]!, y: ranges[axes.y]! }
              : null
          }
          onSelect={(box) =>
            box
              ? onBox(axes.x, box.x, axes.y, box.y)
              : onBox(axes.x, null, axes.y, null)
          }
        />
        <div className="viz-grid-cards">
          {charts.map((c) => (
            <Histogram
              key={c.param}
              label={c.label}
              unit={c.unit}
              values={c.values}
              covered={c.covered}
              intervals={c.intervals}
              marks={previewMarks[c.param]}
              domain={c.domain}
              selection={c.filter ? ranges[c.filter] : null}
              onSelect={
                c.filter ? (range) => onRange(c.filter!, range) : undefined
              }
              splitValue={
                split && c.filter === split.param ? split.value : null
              }
              onSplitPick={
                onSplitPick && c.filter
                  ? (value) => onSplitPick(c.filter!, value)
                  : undefined
              }
            />
          ))}
        </div>
        </>
      )}
      {timeCharts && (
        <div className="import-time-charts">
          <p className="hint-text">
            Each report at its mission time, as written in the file
            {timeCharts.noTime > 0 &&
              ` (${timeCharts.noTime.toLocaleString()} in view have no readable time and aren't shown)`}
            . <strong>Drag a box around the dots you&apos;re interested in</strong> on any chart to mark those
            reports — they light up on all three charts, so marking a stretch of RF shows its PRI and PW. Hold{" "}
            <kbd>Shift</kbd> to add another box, or <kbd>Ctrl</kbd> (<kbd>⌘</kbd>, <kbd>Alt</kbd>) to keep only the
            marked reports inside a box — say, to drop odd PRI values from an RF box. Click a chart to clear. PRI is
            a stagger&apos;s frame time.
          </p>
          {markedSummary && (
            <div className="import-marks">
              <span>
                <strong>{marked.size.toLocaleString()}</strong> report{marked.size === 1 ? "" : "s"} marked
                {(["rf", "pri", "pw"] as RangeParam[]).map((p) => {
                  const [lo, hi] = markedSummary.span[p];
                  if (!Number.isFinite(lo)) return null;
                  return (
                    <span key={p} className="hint-text">
                      {" · "}
                      {AXIS_INFO[p].short} {lo === hi ? fmtValue(lo) : `${fmtValue(lo)}–${fmtValue(hi)}`}{" "}
                      {AXIS_INFO[p].unit}
                    </span>
                  );
                })}
                {markedSummary.kinds.size > 1 && (
                  <span className="hint-text">
                    {" · "}
                    {[...markedSummary.kinds].map(([k, n]) => `${n.toLocaleString()} ${kindLabel(k)}`).join(", ")}
                  </span>
                )}
              </span>
              <span className="import-selection-actions">
                {onGroupLines && (
                  <button
                    type="button"
                    className="button primary small"
                    onClick={() => {
                      onGroupLines([...marked]);
                      setMarks([]);
                    }}
                  >
                    {markedSummary.kinds.size > 1
                      ? `Make ${markedSummary.kinds.size} groups — one per PRI type`
                      : `Make a group of ${marked.size === 1 ? "it" : `these ${marked.size.toLocaleString()}`}`}
                  </button>
                )}
                <button type="button" className="button secondary small" onClick={() => setMarks([])}>
                  Clear marks
                </button>
              </span>
            </div>
          )}
          {timeCharts.charts.map((c) => (
            <Scatter
              key={c.param}
              header={
                <strong>
                  {AXIS_INFO[c.param].short} over time{" "}
                  <span className="hint-text">({AXIS_INFO[c.param].unit})</span>
                </strong>
              }
              height={210}
              xAxis={{ short: "Time", unit: "" }}
              yAxis={AXIS_INFO[c.param]}
              xTicks={(lo, hi) => timeTicks(lo, hi)}
              xFormat={formatTime}
              points={c.points}
              xDomain={timeCharts.xDomain}
              yDomain={c.yDomain}
              selection={null}
              markBoxes={marks
                .filter((m) => m.param === c.param)
                .map((m) => ({ x: m.x, y: m.y, narrow: m.op === "narrow" }))}
              onSelect={(box, { add, narrow }) => {
                if (!box) {
                  if (!add && !narrow) setMarks([]);
                  return;
                }
                const keep = marks.length > 0 && (add || narrow);
                const mark: Mark = { param: c.param, x: box.x, y: box.y, op: keep && narrow ? "narrow" : "add" };
                setMarks(keep ? [...marks, mark] : [mark]);
              }}
              emptyText={
                c.param === "rf"
                  ? "No reports with a time in view."
                  : "No pulsed reports with a time in view."
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
