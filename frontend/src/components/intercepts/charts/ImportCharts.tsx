import { useMemo, useState } from "react";
import type { CsvReport, ReportPriType } from "../interceptCsv";
import type { ReportGroup } from "../interceptGroups";
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
import { Scatter, type ScatterPoint } from "./Scatter";

export type RangeParam = "rf" | "pri" | "pw";
export type Range = [number, number] | null;

const AXIS_INFO: Record<RangeParam, { short: string; unit: string }> = {
  rf: { short: "RF", unit: "MHz" },
  pri: { short: "PRI", unit: "µs" },
  pw: { short: "PW", unit: "µs" },
};
const AXES_KEY = "importScatterAxes";

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
}: {
  reports: CsvReport[];
  excludedLines: Set<number>;
  modes: Mode[] | undefined;
  filters: ChartFilters;
  onRange: (param: RangeParam, range: Range) => void;
  /** A box dragged on the scatter: a range on each of its two parameters. */
  onBox: (x: RangeParam, xRange: Range, y: RangeParam, yRange: Range) => void;
  /** Auto group's preview with the current tolerances — drawn as ticks. */
  preview: ReportGroup[] | null;
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
        !excludedLines.has(r.line) &&
        (!filters.type || r.priType === filters.type) &&
        (!track || r.track === track) &&
        (!filters.identified ||
          (r.designation ?? "not identified") === filters.identified),
    );
  }, [reports, excludedLines, filters.type, filters.track, filters.identified]);

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
            <span>
              <span className="viz-swatch viz-coverage" /> Where the Modes reach
            </span>
            {preview && (
              <span>
                <span className="viz-swatch viz-marks-swatch" /> Auto group
                preview
              </span>
            )}
          </span>
        )}
      </div>
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
            <span className="hint-text">
              PRI is a stagger&apos;s frame time
            </span>
          </span>
        }
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
          />
        ))}
      </div>
    </div>
  );
}
