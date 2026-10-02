import { useMemo, useState } from "react";
import type { InterceptEntry, Mode } from "../../../types/domain";
import type { EntryMatch } from "../interceptMatch";
import type { ReportPriType } from "../interceptCsv";
import { allIntervals, inIntervals, modeCoverage, type ChartParam } from "./coverage";
import { Histogram } from "./Histogram";
import { Scatter, type ScatterBox, type ScatterPoint } from "./Scatter";
import { formatTime, timeTicks } from "./timeAxis";
import { TimeZoom, fitWindow, type TimeWindow } from "./TimeZoom";
import type { Range, RangeParam } from "./ImportCharts";

export type EntryChartTab = "distributions" | "time";
export type SelectMode = "replace" | "add" | "narrow";

const AXIS_INFO: Record<RangeParam, { short: string; unit: string }> = {
  rf: { short: "RF", unit: "MHz" },
  pri: { short: "PRI", unit: "µs" },
  pw: { short: "PW", unit: "µs" },
};
const AXES_KEY = "entryScatterAxes";
// Beyond this many, outlines hide the points rather than show the entries.
const MAX_BOXES = 3000;
// Range boxes start switched on up to this many entries.
const BOXES_BY_DEFAULT = 300;

const HISTOGRAMS: { param: ChartParam; label: string; unit: string; filter: RangeParam }[] = [
  { param: "rf", label: "RF", unit: "MHz", filter: "rf" },
  { param: "pri", label: "PRI — fixed", unit: "µs", filter: "pri" },
  { param: "frame", label: "Frame time — stagger", unit: "µs", filter: "pri" },
  { param: "pw", label: "PW", unit: "µs", filter: "pw" },
];

/** An entry's mean on a parameter — PRI is a stagger's frame time, none for CW. */
export function entryValue(e: InterceptEntry, p: RangeParam): number | null {
  return p === "rf" ? e.rf_mean_mhz : p === "pri" ? e.pri_mean_us : e.pw_mean_us;
}

/** An entry's measured range on a parameter, or its mean when it has none. */
function entrySpan(e: InterceptEntry, p: RangeParam): [number, number] | null {
  const mean = entryValue(e, p);
  if (mean == null) return null;
  const lo = p === "rf" ? e.rf_min_mhz : p === "pri" ? e.pri_min_us : e.pw_min_us;
  const hi = p === "rf" ? e.rf_max_mhz : p === "pri" ? e.pri_max_us : e.pw_max_us;
  return [lo ?? mean, hi ?? mean];
}

function entryTimes(e: InterceptEntry): [number, number] | null {
  if (!e.first_seen_at) return null;
  const a = Date.parse(e.first_seen_at);
  const b = e.last_seen_at ? Date.parse(e.last_seen_at) : a;
  return Number.isFinite(a) && Number.isFinite(b) ? [a, b] : null;
}

export function withinRange(v: number | null, r: Range) {
  return r == null || (v != null && v >= r[0] && v <= r[1]);
}

function extent(values: number[]): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of values) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (!Number.isFinite(lo)) return [0, 1];
  if (lo === hi) return [lo - Math.max(Math.abs(lo) * 0.001, 0.5), hi + Math.max(Math.abs(hi) * 0.001, 0.5)];
  const pad = (hi - lo) * 0.03;
  return [lo - pad, hi + pad];
}

function readAxes(): { x: RangeParam; y: RangeParam } {
  try {
    const stored = JSON.parse(localStorage.getItem(AXES_KEY) ?? "null") as { x?: string; y?: string } | null;
    const keys: RangeParam[] = ["rf", "pri", "pw"];
    const x = keys.find((k) => k === stored?.x);
    const y = keys.find((k) => k === stored?.y);
    if (x && y && x !== y) return { x, y };
  } catch {
    // Unreadable — use the default.
  }
  return { x: "rf", y: "pri" };
}

/** A saved Intercept's entries on charts: each entry is a point at its means,
 * with its measured range as a box. Boxing points selects those entries (for
 * the table's Merge and Delete); dragging across a histogram filters the
 * table to that range. Selected entries are highlighted on every chart. */
export function EntryCharts({
  tab,
  entries,
  matchById,
  modes,
  ranges,
  onRange,
  selected,
  onSelectBox,
}: {
  tab: EntryChartTab;
  /** The entries in view (the table's match filter applied, not its ranges). */
  entries: InterceptEntry[];
  matchById: Map<string, EntryMatch> | null;
  modes: Mode[] | undefined;
  ranges: Record<RangeParam, Range>;
  onRange: (param: RangeParam, range: Range) => void;
  selected: Set<string>;
  /** Entries inside a box drawn on a chart, or none for a click. */
  onSelectBox: (ids: string[], mode: SelectMode) => void;
}) {
  const coverage = useMemo(() => (modes && modes.length > 0 ? modeCoverage(modes) : null), [modes]);
  const matched = (e: InterceptEntry) =>
    matchById ? (matchById.get(e.id)?.status ?? "none") === "match" : null;
  const passes = (e: InterceptEntry, except: RangeParam | null) =>
    (["rf", "pri", "pw"] as RangeParam[]).every((p) => p === except || withinRange(entryValue(e, p), ranges[p]));
  const [axes, setAxesState] = useState(readAxes);
  // Hundreds of range boxes hide the points they belong to; off by default then.
  const [showRanges, setShowRanges] = useState(entries.length <= BOXES_BY_DEFAULT);
  function setAxes(x: RangeParam, y: RangeParam) {
    setAxesState({ x, y });
    try {
      localStorage.setItem(AXES_KEY, JSON.stringify({ x, y }));
    } catch {
      // Not remembered — fine.
    }
  }
  const mode = (o: { add: boolean; narrow: boolean }): SelectMode =>
    o.narrow ? "narrow" : o.add ? "add" : "replace";

  const scatter = useMemo(() => {
    if (tab !== "distributions") return null;
    const rows = entries.filter(
      (e) => passes(e, null) && entryValue(e, axes.x) != null && entryValue(e, axes.y) != null,
    );
    const points: ScatterPoint[] = rows.map((e) => ({
      x: entryValue(e, axes.x)!,
      y: entryValue(e, axes.y)!,
      matched: matched(e),
      marked: selected.has(e.id),
    }));
    const boxes: ScatterBox[] = [];
    for (const e of rows) {
      const sx = entrySpan(e, axes.x)!;
      const sy = entrySpan(e, axes.y)!;
      if (sx[0] !== sx[1] || sy[0] !== sy[1]) boxes.push({ x: sx, y: sy, count: e.report_count ?? 1 });
    }
    const xs = rows.flatMap((e) => entrySpan(e, axes.x)!);
    const ys = rows.flatMap((e) => entrySpan(e, axes.y)!);
    const own = (p: RangeParam, vs: number[]): [number, number] => {
      const r = ranges[p];
      const [lo, hi] = extent(vs);
      return r ? [Number.isFinite(r[0]) ? r[0] : lo, Number.isFinite(r[1]) ? r[1] : hi] : [lo, hi];
    };
    return { rows, points, boxes, xDomain: own(axes.x, xs), yDomain: own(axes.y, ys) };
    // passes and matched read ranges and matchById.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, entries, axes, ranges, matchById, selected]);

  const histograms = useMemo(() => {
    if (tab !== "distributions") return null;
    return HISTOGRAMS.map((h) => {
      const values: number[] = [];
      const covered: boolean[] = [];
      for (const e of entries) {
        if (!passes(e, h.filter)) continue;
        if (h.param === "pri" && e.pri_type !== "fixed") continue;
        if (h.param === "frame" && e.pri_type !== "stagger") continue;
        const v = entryValue(e, h.filter);
        if (v == null) continue;
        const own = ranges[h.filter];
        if (own && (v < own[0] || v > own[1])) continue;
        values.push(v);
        covered.push(inIntervals(coverage?.[h.param][e.pri_type as ReportPriType] ?? [], v));
      }
      const own = ranges[h.filter];
      const [lo, hi] = extent(values);
      return {
        ...h,
        values,
        covered: coverage ? covered : null,
        intervals: coverage ? allIntervals(coverage[h.param]) : [],
        domain: (own
          ? [Number.isFinite(own[0]) ? own[0] : lo, Number.isFinite(own[1]) ? own[1] : hi]
          : [lo, hi]) as [number, number],
      };
    });
    // passes reads ranges.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, entries, ranges, coverage]);

  // The stretch of time the Over time charts are zoomed to; null for all of it.
  const [timeWindow, setTimeWindow] = useState<TimeWindow>(null);
  // Each chart's value axis, when zoomed by dragging along it.
  const [yZoom, setYZoom] = useState<Partial<Record<RangeParam, [number, number]>>>({});

  const time = useMemo(() => {
    if (tab !== "time") return null;
    const timed = entries.filter((e) => passes(e, null) && entryTimes(e));
    const full = extent(timed.flatMap((e) => entryTimes(e)!));
    const win = fitWindow(timeWindow, full);
    const xDomain = win ?? full;
    // Zoomed in, each value axis fits the entries heard in the window.
    const inWindow = (e: InterceptEntry) => {
      if (!win) return true;
      const [a, b] = entryTimes(e)!;
      return a <= win[1] && b >= win[0];
    };
    const charts = (["rf", "pri", "pw"] as RangeParam[]).map((param) => {
      const rows = timed.filter((e) => entryValue(e, param) != null);
      const points: ScatterPoint[] = rows.map((e) => {
        const [a, b] = entryTimes(e)!;
        return { x: (a + b) / 2, y: entryValue(e, param)!, matched: matched(e), marked: selected.has(e.id) };
      });
      const box = (e: InterceptEntry): ScatterBox => ({
        x: entryTimes(e)!,
        y: entrySpan(e, param)!,
        count: e.report_count ?? 1,
      });
      return {
        param,
        rows,
        points,
        boxes: showRanges && rows.length <= MAX_BOXES ? rows.map(box) : [],
        // The selected entries' spans stand out on their own — unless there are so many they'd bury the points.
        selectedBoxes: (() => {
          const chosen = rows.filter((e) => selected.has(e.id));
          return showRanges || chosen.length <= BOXES_BY_DEFAULT ? chosen.map(box) : [];
        })(),
        shown: rows.filter(inWindow).filter((e) => {
          const yz = yZoom[param];
          if (!yz) return true;
          const [lo, hi] = entrySpan(e, param)!;
          return lo <= yz[1] && hi >= yz[0];
        }).length,
        yDomain: yZoom[param] ?? extent(rows.filter(inWindow).flatMap((e) => entrySpan(e, param)!)),
        yZoomed: !!yZoom[param],
      };
    });
    const midTimes = timed.map((e) => {
      const [a, b] = entryTimes(e)!;
      return (a + b) / 2;
    });
    return { charts, xDomain, full, zoomed: win != null, midTimes, untimed: entries.length - timed.length, timed };
    // passes and matched read ranges and matchById.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, entries, ranges, matchById, selected, showRanges, timeWindow, yZoom]);

  // One setting, shown on both tabs: draw a box per entry, or just its point.
  const rangesToggle = (label: string, title: string) => (
    <label
      className="inline-label map-axis"
      title={`${title} Off, each entry is just a point (selected entries still get their box). Starts off above ${BOXES_BY_DEFAULT} entries, where the boxes would hide the points.`}
    >
      <input type="checkbox" checked={showRanges} onChange={(e) => setShowRanges(e.target.checked)} />
      {label}
    </label>
  );

  const axisSelect = (value: RangeParam, other: RangeParam, set: (p: RangeParam) => void, label: string) => (
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
      {scatter && (
        <>
          <p className="hint-text entry-charts-hint">
            Each entry at its means, its measured range as a box. <strong>Drag a box around points</strong> to select
            those entries for the table&apos;s Merge and Delete — <kbd>Shift</kbd> adds, <kbd>Ctrl</kbd> (
            <kbd>⌘</kbd>, <kbd>Alt</kbd>) keeps only the selected ones inside; click to clear. Drag across a
            histogram to filter the table to that range.
          </p>
          <Scatter
            header={
              <span className="map-axes">
                <strong>Entries</strong>
                {axisSelect(axes.x, axes.y, (x) => setAxes(x, axes.y), "Across")}
                {axisSelect(axes.y, axes.x, (y) => setAxes(axes.x, y), "Up")}
                <button type="button" className="link-button" onClick={() => setAxes(axes.y, axes.x)} title="Swap the axes">
                  ⇄ Swap
                </button>
                {rangesToggle(
                  "Box each entry's min–max",
                  "Draws a faint box around each entry's point, from the lowest to the highest value its reports measured on both axes.",
                )}
                <span className="hint-text">PRI is a stagger&apos;s frame time</span>
              </span>
            }
            xAxis={AXIS_INFO[axes.x]}
            yAxis={AXIS_INFO[axes.y]}
            points={scatter.points}
            xDomain={scatter.xDomain}
            yDomain={scatter.yDomain}
            boxes={showRanges && scatter.boxes.length <= MAX_BOXES ? scatter.boxes : []}
            boxStyle="faint"
            noun={["entry", "entries"]}
            selection={null}
            emptyText="No pulsed entries in view."
            onSelect={(box, o) => {
              if (!box) {
                if (!o.add && !o.narrow) onSelectBox([], "replace");
                return;
              }
              const ids = scatter.rows
                .filter((e) => {
                  const x = entryValue(e, axes.x)!;
                  const y = entryValue(e, axes.y)!;
                  return x >= box.x[0] && x <= box.x[1] && y >= box.y[0] && y <= box.y[1];
                })
                .map((e) => e.id);
              onSelectBox(ids, mode(o));
            }}
          />
          <div className="viz-grid-cards entry-histograms">
            {histograms!.map((h) => (
              <Histogram
                key={h.param}
                label={h.label}
                unit={h.unit}
                values={h.values}
                covered={h.covered}
                intervals={h.intervals}
                marks={[]}
                domain={h.domain}
                selection={ranges[h.filter]}
                onSelect={(range) => onRange(h.filter, range)}
              />
            ))}
          </div>
        </>
      )}
      {time && (
        <div className="import-time-charts">
          <p className="hint-text entry-charts-hint">
            Each entry as a box from when it was first to last heard, over its measured range (mission times as
            written in the file)
            {time.untimed > 0 &&
              ` — ${time.untimed.toLocaleString()} entr${time.untimed === 1 ? "y has" : "ies have"} no time (typed in by hand) and aren't shown`}
            . <strong>Drag a box</strong> to select the entries it touches — <kbd>Shift</kbd> adds, <kbd>Ctrl</kbd>{" "}
            keeps only those inside; click to clear. {rangesToggle(
              "Box each entry's time and min–max",
              "Draws each entry as a box from when it was first to last heard, and from the lowest to the highest value its reports measured.",
            )}
          </p>
          {time.timed.length > 0 && (
            <TimeZoom
              full={time.full}
              window={time.zoomed ? time.xDomain : null}
              onChange={setTimeWindow}
              times={time.midTimes}
            />
          )}
          {time.timed.length === 0 ? (
            <p className="hint-text">No entries with a time — these were typed in by hand or imported before times were kept.</p>
          ) : (
            time.charts.map((c) => (
              <Scatter
                key={c.param}
                header={
                  <strong>
                    {AXIS_INFO[c.param].short} over time <span className="hint-text">({AXIS_INFO[c.param].unit})</span>
                  </strong>
                }
                height={200}
                xAxis={{ short: "Time", unit: "" }}
                yAxis={AXIS_INFO[c.param]}
                xTicks={(lo, hi) => timeTicks(lo, hi)}
                xFormat={formatTime}
                points={c.points}
                shownCount={c.shown}
                yZoomed={c.yZoomed}
                onYZoom={(r) =>
                  setYZoom((z) => {
                    const next = { ...z };
                    if (r) next[c.param] = r;
                    else delete next[c.param];
                    return next;
                  })
                }
                xDomain={time.xDomain}
                yDomain={c.yDomain}
                boxes={c.boxes}
                boxStyle="faint"
                noun={["entry", "entries"]}
                markBoxes={c.selectedBoxes}
                selection={null}
                emptyText="No pulsed entries with a time."
                onSelect={(box, o) => {
                  if (!box) {
                    if (!o.add && !o.narrow) onSelectBox([], "replace");
                    return;
                  }
                  const ids = c.rows
                    .filter((e) => {
                      const [a, b] = entryTimes(e)!;
                      const [lo, hi] = entrySpan(e, c.param)!;
                      return a <= box.x[1] && b >= box.x[0] && lo <= box.y[1] && hi >= box.y[0];
                    })
                    .map((e) => e.id);
                  onSelectBox(ids, mode(o));
                }}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}
