import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { platformCoverageApi, type CoverageMode, type EmitterCoverage } from "../../api/platforms";
import { fmt, niceTicks, useWidth } from "../intercepts/charts/Histogram";
import { SERIES_SLOTS } from "../modes/charts/modeRanges";

type Span = [number, number];
type Param = "rf" | "pri" | "pw";
type View = "emitter" | "mode";

const PARAMS: { key: Param; label: string; unit: string }[] = [
  { key: "rf", label: "RF", unit: "MHz" },
  { key: "pri", label: "PRI / frame time", unit: "µs" },
  { key: "pw", label: "PW", unit: "µs" },
];

const ROW = 20;
const HEAD = 28;
const LABEL_W = 230;
const PAD_R = 16;

const VIEW_KEY = "platformChartView";

function spanOf(m: CoverageMode, p: Param, engineered: boolean): Span | null {
  if (p === "rf") return engineered ? m.rf : m.rf_raw;
  if (p === "pri") return engineered ? m.pri : m.pri_raw;
  return engineered ? m.pw : m.pw_raw;
}

/** The ranges an Emitter covers on one parameter: its Modes' ranges joined
 * where they overlap or touch, and kept apart where they don't — 1–2 and
 * 200–205 µs stay two pieces, never 1–205. */
export function coveredRanges(spans: Span[]): Span[] {
  const sorted = [...spans].sort((a, b) => a[0] - b[0]);
  const out: Span[] = [];
  for (const [lo, hi] of sorted) {
    const last = out[out.length - 1];
    if (last && lo <= last[1]) last[1] = Math.max(last[1], hi);
    else out.push([lo, hi]);
  }
  return out;
}

function emitterLabel(e: EmitterCoverage) {
  return e.designation ? `${e.designation} — ${e.emitter_name}` : e.emitter_name;
}

function truncate(s: string, n: number) {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function rangeText(spans: Span[], unit: string) {
  return spans.map(([lo, hi]) => (lo === hi ? fmt(lo) : `${fmt(lo)}–${fmt(hi)}`)).join(", ") + ` ${unit}`;
}

interface Row {
  /** An Emitter's line; a heading over its Modes (no bars); or one Mode. */
  kind: "emitter" | "heading" | "mode";
  label: string;
  title: string;
  colour: number;
  spans: Span[];
}

function ParamChart({
  param,
  rows,
  log,
}: {
  param: (typeof PARAMS)[number];
  rows: Row[];
  log: boolean;
}) {
  const { ref, width } = useWidth<HTMLDivElement>();
  const all = rows.flatMap((r) => r.spans);
  const useLog = log && all.length > 0 && all.every(([lo]) => lo > 0);
  const t = (v: number) => (useLog ? Math.log10(v) : v);
  let lo = Math.min(...all.map((s) => t(s[0])));
  let hi = Math.max(...all.map((s) => t(s[1])));
  if (!Number.isFinite(lo)) [lo, hi] = [0, 1];
  const pad = (hi - lo) * 0.04 || Math.max(Math.abs(lo) * 0.01, 0.5);
  lo -= pad;
  hi += pad;
  const plotW = Math.max(80, width - LABEL_W - PAD_R);
  const x = (v: number) => LABEL_W + ((t(v) - lo) / (hi - lo || 1)) * plotW;
  const ticks = useLog
    ? Array.from({ length: Math.floor(hi) - Math.ceil(lo) + 1 }, (_, i) => 10 ** (Math.ceil(lo) + i))
    : niceTicks(lo, hi);
  const height = HEAD + rows.length * ROW + 8;

  return (
    <div className="viz-card platform-chart">
      <div className="viz-card-header">
        <strong>
          {param.label} <span className="hint-text">({param.unit})</span>
        </strong>
        {log && !useLog && <span className="hint-text">no log scale: a value at or below 0</span>}
      </div>
      <div ref={ref}>
        {width > 0 && rows.length > 0 && (
          <svg width={width} height={height} role="img" aria-label={`${param.label} coverage`}>
            {ticks.map((v) => (
              <g key={v}>
                <line x1={x(v)} x2={x(v)} y1={HEAD - 6} y2={height - 4} className="viz-gridline" />
                <text x={x(v)} y={HEAD - 10} textAnchor="middle" className="viz-axis-label">
                  {fmt(v)}
                </text>
              </g>
            ))}
            {rows.map((r, i) => {
              const y = HEAD + i * ROW;
              return (
                <g key={i}>
                  <title>{`${r.title}\n${r.spans.length ? rangeText(r.spans, param.unit) : "nothing on this parameter"}`}</title>
                  {i % 2 === 0 && <rect x={0} y={y} width={width} height={ROW} className="platform-chart-band" />}
                  <text
                    x={r.kind === "mode" ? 18 : 4}
                    y={y + ROW / 2 + 4}
                    className={r.kind === "mode" ? "platform-chart-label" : "platform-chart-label emitter"}
                  >
                    {truncate(r.label, r.kind === "mode" ? 30 : 32)}
                  </text>
                  {r.spans.map(([a, b], j) => (
                    <rect
                      key={j}
                      x={x(a)}
                      y={y + 4}
                      width={Math.max(2, x(b) - x(a))}
                      height={ROW - 8}
                      rx={2}
                      className="platform-chart-bar"
                      style={{ fill: r.colour < SERIES_SLOTS ? `var(--series-${r.colour + 1})` : "var(--muted)" }}
                    />
                  ))}
                  {r.spans.length === 0 && r.kind === "emitter" && (
                    <text x={LABEL_W + 4} y={y + ROW / 2 + 4} className="hint-text platform-chart-none">
                      —
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        )}
      </div>
    </div>
  );
}

/** What the pinned Emitter versions cover on RF, PRI and PW: one line per
 * Emitter (its Modes' ranges joined only where they overlap, so a gap stays a
 * gap), or one line per Mode grouped under its Emitter. */
export function PlatformCharts({ platformId }: { platformId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["platform-coverage", platformId],
    queryFn: () => platformCoverageApi.get(platformId),
  });
  const [view, setViewState] = useState<View>(() => {
    try {
      return localStorage.getItem(VIEW_KEY) === "mode" ? "mode" : "emitter";
    } catch {
      return "emitter";
    }
  });
  const setView = (v: View) => {
    setViewState(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* not remembered */
    }
  };
  const [engineered, setEngineered] = useState(true);
  const [log, setLog] = useState(false);

  const rowsFor = useMemo(() => {
    const emitters = data ?? [];
    return (p: Param): Row[] =>
      emitters.flatMap((e, i): Row[] => {
        const label = emitterLabel(e);
        const title = `${label} (v${e.version_number})`;
        const spans = e.modes.map((m) => spanOf(m, p, engineered)).filter((s): s is Span => !!s);
        if (view === "emitter") return [{ kind: "emitter" as const, label, title, colour: i, spans: coveredRanges(spans) }];
        return [
          { kind: "heading" as const, label, title, colour: i, spans: [] as Span[] },
          ...e.modes.map((m) => {
            const s = spanOf(m, p, engineered);
            return { kind: "mode" as const, label: m.name, title: `${m.name} — ${title}`, colour: i, spans: s ? [s] : [] };
          }),
        ];
      });
  }, [data, view, engineered]);

  if (isLoading) return <p className="hint-text">Loading what the Emitters cover…</p>;
  if (!data?.length) return <p className="hint-text">Pin an Emitter version to see what this Platform covers.</p>;

  return (
    <div className="platform-charts">
      <div className="platform-charts-controls">
        <div className="theme-toggle" role="group" aria-label="Chart lines">
          <button type="button" className={view === "emitter" ? "active" : undefined} onClick={() => setView("emitter")}>
            Per Emitter
          </button>
          <button type="button" className={view === "mode" ? "active" : undefined} onClick={() => setView("mode")}>
            Per Mode
          </button>
        </div>
        <label className="inline-label">
          <input type="checkbox" checked={engineered} onChange={(e) => setEngineered(e.target.checked)} /> Engineered
          values
        </label>
        <label className="inline-label">
          <input type="checkbox" checked={log} onChange={(e) => setLog(e.target.checked)} /> Log scale
        </label>
        <span className="hint-text">
          {view === "emitter"
            ? "One line per Emitter: its Modes' ranges, joined only where they overlap — a gap is a value no Mode covers."
            : "One line per Mode, under its Emitter."}{" "}
          As of each pinned version.
        </span>
      </div>
      {PARAMS.map((p) => (
        <ParamChart key={p.key} param={p} rows={rowsFor(p.key)} log={log} />
      ))}
      <p className="hint-text">
        {data.map((e, i) => (
          <span key={e.emitter_id} className="platform-chart-legend">
            <span
              className="platform-chart-swatch"
              style={{ background: i < SERIES_SLOTS ? `var(--series-${i + 1})` : "var(--muted)" }}
            />
            <Link to={`/emitters/${e.emitter_id}`}>{emitterLabel(e)}</Link> v{e.version_number} · {e.modes.length} Mode
            {e.modes.length === 1 ? "" : "s"}
          </span>
        ))}
      </p>
    </div>
  );
}
