import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { niceTicks, useWidth } from "../intercepts/charts/Histogram";
import type { Dwell } from "../../api/dwells";

const M = { top: 34, right: 18, bottom: 12, left: 58 };
const ROW = 26;
const MIN_BAND = 6;
const LANE = 9;
const LANE_GAP = 3;
// Overlay colours: series-2 onwards (series-1 is the dwells').
const OVERLAY_SLOTS = 7;
// Cut-gaps scale: the width a cut gap is drawn at, and the least a stretch
// with something in it gets (as a share of the whole).
const GAP_PX = 22;
const MIN_SHARE = 0.08;
// The time axis when there are no dwells yet, so the Emitters still show.
const EMPTY_CYCLE_MS = 100;

type Span = [number, number];
export type DwellScale = "cut" | "linear" | "log";
const SCALE_KEY = "dwellChartScale";

const SCALES: { key: DwellScale; label: string; title: string }[] = [
  { key: "cut", label: "Cut gaps", title: "Leave out the stretches where nothing is dwelt on or transmitted" },
  { key: "linear", label: "Linear", title: "Every MHz the same width" },
  { key: "log", label: "Log", title: "A logarithmic frequency axis" },
];

/** A number as the dwell pages write it: no thousands separators, trimmed. */
export function num(v: number): string {
  return String(Number(v.toPrecision(10)));
}

/** "3020–3040 MHz": the stretch a dwell's band covers. */
export function bandText(freqMhz: number, bandwidthMhz: number): string {
  return `${num(freqMhz - bandwidthMhz / 2)}–${num(freqMhz + bandwidthMhz / 2)} MHz`;
}

/** Something drawn behind the dwells across the frequencies it occupies —
 * e.g. one of the Platform's Emitters and its Modes' RF ranges. */
export interface DwellOverlay {
  id: string;
  label: string;
  spans: Span[];
  href?: string;
}

/** Ranges joined where they overlap or touch. */
function joined(spans: Span[]): Span[] {
  const out: Span[] = [];
  for (const [lo, hi] of [...spans].sort((a, b) => a[0] - b[0])) {
    const last = out[out.length - 1];
    if (last && lo <= last[1]) last[1] = Math.max(last[1], hi);
    else out.push([lo, hi]);
  }
  return out;
}

/** How much of an overlay's frequencies the dwell bands sit on: a share of
 * its total width (0–1), or — when it's single frequencies only — whether
 * any band holds one of them. */
export function dwellCoverage(spans: Span[], bands: Span[]): number {
  const own = joined(spans);
  const cover = joined(bands);
  const total = own.reduce((sum, [lo, hi]) => sum + (hi - lo), 0);
  if (total === 0) return own.some(([f]) => cover.some(([lo, hi]) => f >= lo && f <= hi)) ? 1 : 0;
  let covered = 0;
  for (const [lo, hi] of own)
    for (const [blo, bhi] of cover) covered += Math.max(0, Math.min(hi, bhi) - Math.max(lo, blo));
  return covered / total;
}

export interface XScale {
  x: (mhz: number) => number;
  ticks: number[];
  /** Cut-out stretches, in px, to mark on the chart. */
  breaks: { x0: number; x1: number; from: number; to: number }[];
}

/** The frequency axis over `spans` (everything drawn), `left` to `left + width` px. */
export function buildScale(mode: DwellScale, spans: Span[], left: number, width: number, minPad: number): XScale {
  const lo0 = Math.min(...spans.map((s) => s[0]));
  const hi0 = Math.max(...spans.map((s) => s[1]));
  const whole = hi0 - lo0 || Math.max(minPad, 1);
  const linear = (lo: number, hi: number): XScale => {
    const x = (f: number) => left + ((f - lo) / (hi - lo)) * width;
    const ticks = niceTicks(lo, hi, Math.max(3, Math.floor(width / 90))).filter((t) => t >= lo && t <= hi);
    return { x, ticks, breaks: [] };
  };
  const pad = Math.max(minPad, whole * 0.02);

  if (mode === "log" && lo0 > 0) {
    const lo = Math.max(lo0 - pad, lo0 / 1.15);
    const hi = hi0 + pad;
    const [a, b] = [Math.log10(lo), Math.log10(hi)];
    const x = (f: number) => left + ((Math.log10(Math.max(f, lo)) - a) / (b - a)) * width;
    const ticks: number[] = [];
    for (let k = Math.floor(a); k <= Math.ceil(b); k++)
      for (const m of [1, 2, 5]) {
        const t = m * 10 ** k;
        if (t >= lo && t <= hi) ticks.push(t);
      }
    // A narrow span has few decade marks: fall back to plain ones there.
    return { x, ticks: ticks.length >= 3 ? ticks : linear(lo, hi).ticks, breaks: [] };
  }
  if (mode !== "cut") return linear(Math.max(0, lo0 - pad), hi0 + pad);

  // Stretches with something in them, padded, with small gaps closed up.
  const segments: Span[] = [];
  for (const [a, b] of joined(spans.map(([a, b]) => [Math.max(0, a - pad), b + pad] as Span))) {
    const last = segments[segments.length - 1];
    if (last && a - last[1] < whole * 0.06) last[1] = b;
    else segments.push([a, b]);
  }
  if (segments.length === 1) return linear(segments[0][0], segments[0][1]);

  const lengths = segments.map(([a, b]) => b - a);
  const sum = lengths.reduce((s, l) => s + l, 0);
  const weights = lengths.map((l) => Math.max(l, sum * MIN_SHARE));
  const avail = width - GAP_PX * (segments.length - 1);
  const totalW = weights.reduce((s, w) => s + w, 0);
  const px = weights.map((w) => (avail * w) / totalW);
  const starts: number[] = [];
  let at = left;
  for (const p of px) {
    starts.push(at);
    at += p + GAP_PX;
  }
  const x = (f: number) => {
    for (let i = 0; i < segments.length; i++) {
      const [a, b] = segments[i];
      if (f <= b || i === segments.length - 1) {
        if (f >= a || i === 0) return starts[i] + ((f - a) / (b - a)) * px[i];
        // In the gap before this stretch.
        const prevEnd = segments[i - 1][1];
        return starts[i - 1] + px[i - 1] + ((f - prevEnd) / (a - prevEnd)) * GAP_PX;
      }
    }
    return left + width;
  };
  const ticks: number[] = [];
  segments.forEach(([a, b], i) => {
    for (const t of niceTicks(a, b, Math.max(2, Math.floor(px[i] / 80))))
      if (t >= a && t <= b && (ticks.length === 0 || x(t) - x(ticks[ticks.length - 1]) > 40)) ticks.push(t);
  });
  const breaks = segments.slice(1).map((s, i) => ({
    x0: starts[i] + px[i],
    x1: starts[i + 1],
    from: segments[i][1],
    to: s[0],
  }));
  return { x, ticks, breaks };
}

function readScale(): DwellScale {
  try {
    const v = localStorage.getItem(SCALE_KEY);
    return v === "linear" || v === "log" || v === "cut" ? v : "cut";
  } catch {
    return "cut";
  }
}

/** One cycle of a Strategy as a waterfall: frequency (MHz) across, time (ms)
 * running down. Each dwell is a band of the given width around its
 * frequency, from when it starts to when the next one does; dashed lines
 * show the hop to the next. Hovering a band (or, from outside, a table row)
 * shows its details beside it. With `overlay`, each one (an Emitter, say) is
 * shaded behind the dwells across its frequencies and drawn in a lane under
 * the chart; the legend shows or hides each, and how much of it the dwells
 * sit on. With no dwells yet the overlay still shows, to plan against. The
 * frequency axis can leave out the stretches with nothing in them. */
export function DwellChart({
  dwells,
  bandwidthMhz,
  hover: hoverProp,
  onHover,
  height,
  title = "Dwells over one cycle",
  overlay,
  overlayTitle = "Emitters",
  controls,
  emptyText = "No dwells yet.",
}: {
  dwells: Dwell[];
  bandwidthMhz: number;
  /** The dwell picked out (index into `dwells`), when the page shares it. */
  hover?: number | null;
  onHover?: (index: number | null) => void;
  /** Fixed plot height; by default it grows with the number of dwells. */
  height?: number;
  title?: string;
  overlay?: DwellOverlay[];
  overlayTitle?: string;
  /** More controls for the chart's header (e.g. the band width). */
  controls?: ReactNode;
  emptyText?: string;
}) {
  const { ref, width } = useWidth<HTMLDivElement>();
  const [ownHover, setOwnHover] = useState<number | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [hoverOverlay, setHoverOverlay] = useState<string | null>(null);
  const [scaleMode, setScaleMode] = useState<DwellScale>(readScale);
  const hover = hoverProp !== undefined ? hoverProp : ownHover;
  const setHover = (i: number | null) => (onHover ? onHover(i) : setOwnHover(i));
  function pickScale(mode: DwellScale) {
    setScaleMode(mode);
    try {
      localStorage.setItem(SCALE_KEY, mode);
    } catch {
      // Not kept: the default next time.
    }
  }

  // Dwells still being typed (no frequency or time yet) are left out, but
  // keep their number so the chart and the table agree.
  const steps = dwells.map((d, i) => ({ d, i })).filter(({ d }) => d.freq_mhz > 0 && d.dwell_time_ms > 0);
  const half = bandwidthMhz / 2;
  const bands: Span[] = steps.map(({ d }) => [d.freq_mhz - half, d.freq_mhz + half]);
  const layers = (overlay ?? [])
    .filter((o) => o.spans.length > 0)
    .map((o, k) => ({ ...o, slot: (k % OVERLAY_SLOTS) + 2, coverage: dwellCoverage(o.spans, bands) }));
  const shown = layers.filter((o) => !hidden.has(o.id));
  const drawn = [...bands, ...shown.flatMap((o) => o.spans)];

  const header = (
    <div className="viz-card-header dwell-chart-header">
      <strong>{title}</strong>
      <div className="dwell-chart-controls">
        {controls}
        {drawn.length > 0 && (
          <span className="theme-toggle" role="group" aria-label="Frequency axis">
            {SCALES.map((s) => (
              <button
                key={s.key}
                type="button"
                className={scaleMode === s.key ? "active" : ""}
                aria-pressed={scaleMode === s.key}
                title={s.title}
                onClick={() => pickScale(s.key)}
              >
                {s.label}
              </button>
            ))}
          </span>
        )}
      </div>
    </div>
  );
  if (drawn.length === 0) {
    return (
      <div className="viz-card dwell-chart">
        {header}
        <p className="hint-text dwell-chart-empty">{emptyText} Add a dwell with a frequency and a dwell time to see it here.</p>
      </div>
    );
  }

  let t = 0;
  const placed = steps.map(({ d, i }) => {
    const start = t;
    t += d.dwell_time_ms;
    return { d, i, start, end: t };
  });
  const total = t || EMPTY_CYCLE_MS;

  const plotH = height ?? Math.min(520, Math.max(220, steps.length * ROW));
  const lanesTop = M.top + plotH + (shown.length ? 8 : 0);
  const H = lanesTop + shown.length * (LANE + LANE_GAP) + M.bottom;
  const plotW = Math.max(160, width - M.left - M.right);
  const scale = buildScale(scaleMode, drawn, M.left, plotW, Math.max(bandwidthMhz, 1));
  const x = scale.x;
  const y = (ms: number) => M.top + (ms / total) * plotH;
  const picked = placed.find((p) => p.i === hover);
  const pickedLayer = layers.find((o) => o.id === hoverOverlay);
  const spanText = (spans: Span[]) => joined(spans).map(([a, b]) => (a === b ? num(a) : `${num(a)}–${num(b)}`)).join(", ");
  const pct = (c: number) => (c >= 0.995 ? "all" : c <= 0 ? "none" : `${Math.round(c * 100)}%`);

  // The details box beside the picked dwell (or by the picked Emitter's lane).
  let tip: ReactNode = null;
  if (picked) {
    const right = x(picked.d.freq_mhz + half) + 10;
    const flip = right > width - 230;
    tip = (
      <div
        className="dwell-tip"
        style={{
          top: Math.min(y(picked.start), H - 70),
          ...(flip ? { right: width - x(picked.d.freq_mhz - half) + 10 } : { left: right }),
        }}
      >
        <span className="dwell-tip-freq">{bandText(picked.d.freq_mhz, bandwidthMhz)}</span>
        <span>
          Dwell {picked.i + 1} · {num(picked.start)}–{num(picked.end)} ms
        </span>
        <span className="dwell-tip-minor">
          dwell {num(picked.d.dwell_time_ms)} ms · collect {num(picked.d.collect_time_ms)} ms
        </span>
      </div>
    );
  } else if (pickedLayer) {
    tip = (
      <div className="dwell-tip" style={{ top: Math.max(0, lanesTop - 76), left: M.left + 8 }}>
        <span className="dwell-tip-name">{pickedLayer.label}</span>
        <span className="dwell-tip-freq">{spanText(pickedLayer.spans)} MHz</span>
        <span className="dwell-tip-minor">{pct(pickedLayer.coverage)} of it dwelt on</span>
      </div>
    );
  }

  return (
    <div className="viz-card dwell-chart">
      {header}
      <div className="dwell-chart-summary hint-text">
        {steps.length > 0 && (
          <span className="dwell-cycle" title="How long one pass through every dwell takes">
            Cycle <strong>{num(t)} ms</strong>
            {t >= 1000 && <span className="dwell-cycle-s"> ({num(Math.round(t / 10) / 100)} s)</span>}
          </span>
        )}
        {steps.length
          ? `${steps.length} dwell${steps.length === 1 ? "" : "s"} · bands ${num(bandwidthMhz)} MHz wide`
          : `${emptyText} The ${overlayTitle.toLowerCase().includes("emitter") ? "Emitters'" : "overlaid"} frequencies are shown to plan against.`}
        {scale.breaks.length > 0 &&
          ` · ${scale.breaks.length} empty stretch${scale.breaks.length === 1 ? "" : "es"} cut (${scale.breaks
            .map((b) => `${num(Math.round(b.from))}–${num(Math.round(b.to))}`)
            .join(", ")} MHz)`}
      </div>
      <div ref={ref} className="viz-plot dwell-plot" onPointerLeave={() => setHover(null)}>
        <svg width={width} height={H} role="img" aria-label="Each dwell's frequency (across) against time (down), over one cycle">
          {shown.map((o) =>
            joined(o.spans).map(([a, b], j) => (
              <rect
                key={`${o.id}-${j}`}
                className={`dwell-occupied series-${o.slot}${hoverOverlay === o.id ? " picked" : ""}${
                  hoverOverlay && hoverOverlay !== o.id ? " faded" : ""
                }`}
                x={x(a)}
                y={M.top}
                width={Math.max(2, x(b) - x(a))}
                height={plotH}
              />
            )),
          )}
          {scale.breaks.map((b, k) => (
            <g key={`break${k}`} className="dwell-break">
              <title>{`${num(Math.round(b.from))}–${num(Math.round(b.to))} MHz left out: nothing there`}</title>
              <rect x={b.x0} y={M.top} width={b.x1 - b.x0} height={plotH} />
              <path
                d={`M${b.x0 + 4} ${M.top - 5} l4 10 M${b.x1 - 8} ${M.top - 5} l4 10`}
                className="dwell-break-mark"
              />
            </g>
          ))}
          {scale.ticks.map((v) => (
            <g key={`x${v}`}>
              <line className="viz-grid" x1={x(v)} x2={x(v)} y1={M.top} y2={M.top + plotH} />
              <text className="viz-axis-label" x={x(v)} y={M.top - 8} textAnchor="middle">
                {num(v)}
              </text>
            </g>
          ))}
          {niceTicks(0, total, Math.max(3, Math.floor(plotH / 50))).map((v) => (
            <g key={`y${v}`}>
              <line className="viz-grid" x1={M.left} x2={M.left + plotW} y1={y(v)} y2={y(v)} />
              <text className="viz-axis-label" x={M.left - 6} y={y(v) + 4} textAnchor="end">
                {num(v)}
              </text>
            </g>
          ))}
          <text className="viz-axis-label" x={M.left + plotW / 2} y={11} textAnchor="middle">
            Frequency (MHz){scaleMode === "log" ? " · log" : ""}
          </text>
          <text className="viz-axis-label" transform={`translate(12 ${M.top + plotH / 2}) rotate(-90)`} textAnchor="middle">
            Time (ms)
          </text>
          {steps.length === 0 && (
            <text className="dwell-plot-empty" x={M.left + plotW / 2} y={M.top + plotH / 2} textAnchor="middle">
              {emptyText}
            </text>
          )}

          {placed.slice(1).map((p, k) => {
            const prev = placed[k];
            return (
              <line
                key={`hop${p.i}`}
                className="dwell-hop"
                x1={x(prev.d.freq_mhz)}
                y1={y(prev.end)}
                x2={x(p.d.freq_mhz)}
                y2={y(p.start)}
              />
            );
          })}
          {placed.map(({ d, i, start, end }) => {
            // Too narrow to see at this span: a band of MIN_BAND px centred on it.
            const natural = x(d.freq_mhz + half) - x(d.freq_mhz - half);
            const w = Math.max(MIN_BAND, natural);
            const left = natural < MIN_BAND ? x(d.freq_mhz) - MIN_BAND / 2 : x(d.freq_mhz - half);
            const top = y(start);
            const h = Math.max(2, y(end) - top);
            const inside = w >= 16 && h >= 13;
            return (
              <g
                key={i}
                className={`dwell-step${hover === i ? " hovered" : ""}${hover != null && hover !== i ? " dimmed" : ""}`}
                onPointerEnter={() => setHover(i)}
              >
                {/* A wider invisible target, so a thin band is easy to point at. */}
                <rect className="dwell-hit" x={left - 4} y={top} width={w + 8} height={h} />
                <rect className="dwell-band series-1" x={left} y={top} width={w} height={h} rx={2} />
                {h >= 9 && (
                  <text
                    className={inside ? "dwell-step-label inside" : "dwell-step-label"}
                    x={inside ? left + w / 2 : left + w + 4}
                    y={top + Math.min(h, 22) / 2 + 4}
                    textAnchor={inside ? "middle" : "start"}
                  >
                    {i + 1}
                  </text>
                )}
              </g>
            );
          })}
          <line className="viz-axis" x1={M.left} x2={M.left + plotW} y1={M.top} y2={M.top} />
          <line className="viz-axis" x1={M.left} x2={M.left} y1={M.top} y2={M.top + plotH} />

          {shown.map((o, k) => (
            <g
              key={`lane-${o.id}`}
              className={hoverOverlay && hoverOverlay !== o.id ? "dwell-lane faded" : "dwell-lane"}
              onPointerEnter={() => setHoverOverlay(o.id)}
              onPointerLeave={() => setHoverOverlay(null)}
            >
              <rect className="dwell-lane-track" x={M.left} y={lanesTop + k * (LANE + LANE_GAP)} width={plotW} height={LANE} />
              {joined(o.spans).map(([a, b], j) => (
                <rect
                  key={j}
                  className={`series-${o.slot}`}
                  x={x(a)}
                  y={lanesTop + k * (LANE + LANE_GAP)}
                  width={Math.max(3, x(b) - x(a))}
                  height={LANE}
                  rx={2}
                />
              ))}
            </g>
          ))}
        </svg>
        {tip}
      </div>
      {layers.length > 0 && (
        <div className="dwell-overlay-legend">
          <span className="dwell-overlay-title">{overlayTitle}</span>
          {layers.map((o) => {
            const off = hidden.has(o.id);
            return (
              <span
                key={o.id}
                className={off ? "dwell-overlay-item off" : "dwell-overlay-item"}
                onPointerEnter={() => setHoverOverlay(off ? null : o.id)}
                onPointerLeave={() => setHoverOverlay(null)}
              >
                <button
                  type="button"
                  className="dwell-overlay-toggle"
                  aria-pressed={!off}
                  aria-label={off ? `Show ${o.label}` : `Hide ${o.label}`}
                  title={off ? "Show it on the chart" : "Hide it from the chart"}
                  onClick={() => {
                    const next = new Set(hidden);
                    if (off) next.delete(o.id);
                    else next.add(o.id);
                    setHidden(next);
                  }}
                >
                  <span className={`viz-swatch series-${o.slot}`} />
                </button>
                {o.href ? <Link to={o.href}>{o.label}</Link> : o.label}
                {steps.length > 0 && (
                  <span
                    className={
                      o.coverage <= 0 ? "dwell-coverage none" : o.coverage < 0.995 ? "dwell-coverage part" : "dwell-coverage"
                    }
                    title={`${spanText(o.spans)} MHz — how much of it the dwell bands sit on`}
                  >
                    {o.coverage <= 0 ? "not dwelt on" : `${pct(o.coverage)} dwelt on`}
                  </span>
                )}
              </span>
            );
          })}
          {layers.length > 1 && (
            <button
              type="button"
              className="link-button"
              onClick={() => setHidden(hidden.size ? new Set() : new Set(layers.map((o) => o.id)))}
            >
              {hidden.size ? "Show all" : "Hide all"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
