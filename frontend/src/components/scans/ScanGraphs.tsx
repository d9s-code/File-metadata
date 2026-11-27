/** Two pictures of a scan: how the beam moves (drawn from its own values —
 * the sector, the bars, the cone…), and when it's on a target over a few
 * revisits. Schematic, not to scale: a beam narrower than a few degrees is
 * drawn wider so it can be seen (its real width is labelled). */
import { useState } from "react";
import type { EmitterScan } from "../../api/scans";
import { num, PATTERN_BY_ID, type ScanPatternId, type ScanTiming } from "./scanPatterns";

type Scan = Pick<EmitterScan, "pattern" | "params" | "beam_az_deg" | "beam_el_deg">;

const W = 240;
const H = 170;
const INK = "var(--viz-ink-muted)";
const PATH = "var(--series-1)";
const BEAM = "var(--series-1)";
const GRID = "var(--viz-grid)";

function Arrow({ id }: { id: string }) {
  return (
    <defs>
      <marker id={id} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path d="M0,0 L8,4 L0,8 z" fill={PATH} />
      </marker>
    </defs>
  );
}

const rad = (deg: number) => (deg * Math.PI) / 180;
/** A point at `deg` (0 = up, clockwise) and radius r around (cx, cy). */
const polar = (cx: number, cy: number, r: number, deg: number) => [cx + r * Math.sin(rad(deg)), cy - r * Math.cos(rad(deg))] as const;

function wedge(cx: number, cy: number, r: number, from: number, to: number) {
  const [x1, y1] = polar(cx, cy, r, from);
  const [x2, y2] = polar(cx, cy, r, to);
  return `M${cx},${cy} L${x1},${y1} A${r},${r} 0 ${to - from > 180 ? 1 : 0} 1 ${x2},${y2} Z`;
}

function arc(cx: number, cy: number, r: number, from: number, to: number) {
  const [x1, y1] = polar(cx, cy, r, from);
  const [x2, y2] = polar(cx, cy, r, to);
  return `M${x1},${y1} A${r},${r} 0 ${Math.abs(to - from) > 180 ? 1 : 0} ${to > from ? 1 : 0} ${x2},${y2}`;
}

/** The beam as drawn: at least 6° so it shows. */
const shown = (deg: number | null | undefined) => Math.max(6, deg ?? 6);

function Label({ x, y, children, anchor = "middle" }: { x: number; y: number; children: React.ReactNode; anchor?: "start" | "middle" | "end" }) {
  return (
    <text x={x} y={y} textAnchor={anchor} fontSize="10" fill={INK}>
      {children}
    </text>
  );
}

/** Az–el box with bars swept alternately, the beam's footprint on the first. */
function Raster({ v, az, el, nutation }: { v: Record<string, number>; az: number | null; el: number | null; nutation?: number }) {
  const bars = Math.min(12, Math.max(1, Math.round(v.bars || 4)));
  const x0 = 24;
  const x1 = W - 16;
  const y0 = 34;
  const y1 = H - 30;
  const step = bars > 1 ? (y1 - y0) / (bars - 1) : 0;
  const sector = v.sector_deg || 60;
  const bw = Math.max(8, ((az ?? 3) / sector) * (x1 - x0));
  // The beam's height against the bar spacing, kept inside the box.
  const bh = Math.min(40, Math.max(8, el && v.bar_spacing_deg ? (el / v.bar_spacing_deg) * step : step * 0.8 || 12));
  const lines = Array.from({ length: bars }, (_, i) => {
    const y = y0 + i * step;
    const [a, b] = i % 2 ? [x1, x0] : [x0, x1];
    return <path key={i} d={`M${a},${y} L${b},${y}`} stroke={PATH} strokeWidth="1.5" markerEnd="url(#scan-arrow)" fill="none" />;
  });
  return (
    <>
      <Arrow id="scan-arrow" />
      <rect x={x0} y={y0 - 8} width={x1 - x0} height={y1 - y0 + 16} fill="none" stroke={GRID} />
      {lines}
      {Array.from({ length: bars - 1 }, (_, i) => {
        const y = y0 + i * step;
        const x = i % 2 ? x0 : x1;
        return <path key={`s${i}`} d={`M${x},${y} L${x},${y + step}`} stroke={PATH} strokeWidth="1" strokeDasharray="2 2" fill="none" />;
      })}
      <ellipse cx={x0 + bw / 2 + 2} cy={y0} rx={bw / 2} ry={bh / 2} fill={BEAM} fillOpacity="0.25" stroke={BEAM} />
      {nutation ? <circle cx={x0 + bw / 2 + 2} cy={y0} r={Math.max(4, bh / 2 + 3)} fill="none" stroke={BEAM} strokeDasharray="2 2" /> : null}
      <Label x={(x0 + x1) / 2} y={H - 12}>
        {num(sector)}° × {bars} bar{bars === 1 ? "" : "s"}
        {v.bar_spacing_deg ? `, ${num(v.bar_spacing_deg)}° apart` : ""}
      </Label>
      <Label x={4} y={(y0 + y1) / 2} anchor="start">
        el
      </Label>
      <Label x={x1} y={12} anchor="end">
        beam {az ? `${num(az)}°` : "—"}
        {el ? ` × ${num(el)}°` : ""}
      </Label>
    </>
  );
}

function Drawing({ scan }: { scan: Scan }) {
  const v = (scan.params ?? {}) as Record<string, number>;
  const az = scan.beam_az_deg;
  const cx = W / 2;
  const cy = H / 2 + 4;
  const r = 62;
  switch (scan.pattern as ScanPatternId) {
    case "circular":
    case "helical":
    case "palmer": {
      const b = shown(az);
      return (
        <>
          <Arrow id="scan-arrow" />
          <circle cx={cx} cy={cy} r={r} fill="none" stroke={GRID} />
          <path d={wedge(cx, cy, r, 20 - b / 2, 20 + b / 2)} fill={BEAM} fillOpacity="0.25" stroke={BEAM} />
          <path d={arc(cx, cy, r + 8, 40, 140)} stroke={PATH} strokeWidth="1.5" fill="none" markerEnd="url(#scan-arrow)" />
          {scan.pattern === "palmer" &&
            Array.from({ length: 10 }, (_, i) => {
              const [x, y] = polar(cx, cy, r - 6, 160 + i * 18);
              return <circle key={i} cx={x} cy={y} r={Math.max(3, (v.nutation_deg || 2) * 1.5)} fill="none" stroke={PATH} strokeWidth="1" />;
            })}
          {scan.pattern === "helical" &&
            [0.45, 0.7].map((k) => <circle key={k} cx={cx} cy={cy} r={r * k} fill="none" stroke={PATH} strokeDasharray="3 3" strokeWidth="1" />)}
          <circle cx={cx} cy={cy} r="2.5" fill={INK} />
          <Label x={cx} y={H - 4}>
            {v.period_s ? `${num(v.period_s)} s a turn (${num(60 / v.period_s)} rpm)` : "Rotation period not set"}
            {scan.pattern === "helical" && v.levels ? ` × ${Math.round(v.levels)} levels` : ""}
          </Label>
          <Label x={W - 4} y={14} anchor="end">
            beam {az ? `${num(az)}°` : "—"}
          </Label>
        </>
      );
    }
    case "sector_uni":
    case "sector_bi": {
      const s = Math.min(330, Math.max(10, v.sector_deg || 90));
      const b = shown(az);
      return (
        <>
          <Arrow id="scan-arrow" />
          <path d={wedge(cx, cy + 30, r + 10, -s / 2, s / 2)} fill="none" stroke={GRID} />
          <path d={wedge(cx, cy + 30, r + 10, -s / 2, -s / 2 + b)} fill={BEAM} fillOpacity="0.25" stroke={BEAM} />
          <path
            d={arc(cx, cy + 30, r + 18, -s / 2, s / 2)}
            stroke={PATH}
            strokeWidth="1.5"
            fill="none"
            markerEnd="url(#scan-arrow)"
            markerStart={scan.pattern === "sector_bi" ? "url(#scan-arrow)" : undefined}
          />
          {scan.pattern === "sector_uni" && (
            <path d={arc(cx, cy + 30, r - 4, s / 2, -s / 2)} stroke={PATH} strokeWidth="1" strokeDasharray="3 3" fill="none" markerEnd="url(#scan-arrow)" />
          )}
          <circle cx={cx} cy={cy + 30} r="2.5" fill={INK} />
          <Label x={cx} y={H - 4}>
            {num(s)}° sector{v.sweep_s ? `, ${num(v.sweep_s)} s a sweep` : ""}
            {scan.pattern === "sector_uni" && v.flyback_s ? ` + ${num(v.flyback_s)} s back` : ""}
          </Label>
        </>
      );
    }
    case "raster":
      return <Raster v={v} az={az} el={scan.beam_el_deg} />;
    case "palmer_raster":
      return <Raster v={v} az={az} el={scan.beam_el_deg} nutation={v.nutation_deg || 2} />;
    case "spiral": {
      const turns = Math.min(10, Math.max(1, Math.round(v.turns || 4)));
      const pts: string[] = [];
      for (let i = 0; i <= turns * 72; i++) {
        const [x, y] = polar(cx, cy - 4, (i / (turns * 72)) * r, i * 5);
        pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
      }
      const beamR = Math.max(4, ((az ?? 2) / (v.cone_deg || 20)) * r);
      const [bx, by] = polar(cx, cy - 4, r, turns * 360);
      return (
        <>
          <circle cx={cx} cy={cy - 4} r={r} fill="none" stroke={GRID} />
          <polyline points={pts.join(" ")} fill="none" stroke={PATH} strokeWidth="1.2" />
          <circle cx={bx} cy={by} r={beamR} fill={BEAM} fillOpacity="0.25" stroke={BEAM} />
          <Label x={cx} y={H - 4}>
            {num(v.cone_deg || 0)}° cone, {turns} turn{turns === 1 ? "" : "s"}
            {v.frame_s ? ` in ${num(v.frame_s)} s` : ""}
          </Label>
        </>
      );
    }
    case "esa": {
      const cols = 7;
      const rows = 4;
      return (
        <>
          {Array.from({ length: cols * rows }, (_, i) => {
            const x = 40 + (i % cols) * 27;
            const y = 26 + Math.floor(i / cols) * 28;
            const on = i === 9;
            return (
              <circle key={i} cx={x} cy={y} r="9" fill={on ? BEAM : "none"} fillOpacity={on ? 0.3 : 0} stroke={on ? BEAM : GRID} />
            );
          })}
          <Label x={cx} y={H - 4}>
            {v.pulses ? `${Math.round(v.pulses)} pulses` : v.dwell_ms ? `${num(v.dwell_ms)} ms` : "—"} a position
            {v.revisit_s ? `, back every ${num(v.revisit_s)} s` : ""}
          </Label>
        </>
      );
    }
    case "conical":
    case "lobe_switching":
    case "steady": {
      const lobes = scan.pattern === "conical" ? 8 : scan.pattern === "lobe_switching" ? 2 : 0;
      return (
        <>
          {Array.from({ length: lobes }, (_, i) => {
            const [x, y] = polar(cx, cy - 6, 14, (360 / lobes) * i + (lobes === 2 ? 90 : 0));
            return <circle key={i} cx={x} cy={y} r="26" fill="none" stroke={PATH} strokeOpacity={i === 0 ? 1 : 0.35} />;
          })}
          {!lobes && <circle cx={cx} cy={cy - 6} r="26" fill={BEAM} fillOpacity="0.25" stroke={BEAM} />}
          <path d={`M${cx - 5},${cy - 6} L${cx + 5},${cy - 6} M${cx},${cy - 11} L${cx},${cy - 1}`} stroke={INK} strokeWidth="1.5" />
          <Label x={cx} y={H - 4}>
            On the target all the time{v.rate_hz ? `, ${num(v.rate_hz)} Hz` : ""}
          </Label>
        </>
      );
    }
    default:
      return (
        <Label x={cx} y={cy}>
          Typed in: no drawing
        </Label>
      );
  }
}

/** How the beam moves, drawn from the scan's values. */
export function ScanPatternDrawing({ scan }: { scan: Scan }) {
  const def = PATTERN_BY_ID.get(scan.pattern as ScanPatternId);
  return (
    <figure className="scan-figure">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${def?.name ?? "Scan"} pattern`}>
        <Drawing scan={scan} />
      </svg>
      <figcaption>How the beam moves{def ? ` — ${def.name.toLowerCase()}` : ""}</figcaption>
    </figure>
  );
}

interface Look {
  start: number;
  length: number;
  label: string;
}

/** When the beam is on a target, s: each look over three revisits. */
function looksOf(scan: Scan, t: ScanTiming): { looks: Look[]; span: number } {
  const v = (scan.params ?? {}) as Record<string, number>;
  const rev = t.revisitS?.nom;
  const ill = (t.illuminationMs?.nom ?? 0) / 1000;
  if (!rev || !ill) return { looks: [], span: 0 };
  const looks: Look[] = [];
  const cycles = 3;
  const line = scan.pattern === "raster" || scan.pattern === "palmer_raster" ? rev / Math.max(1, Math.round(v.bars || 1)) : 0;
  for (let c = 0; c < cycles; c++) {
    if (scan.pattern === "sector_bi") {
      // A target mid-sector: once on the way out, once on the way back.
      for (const k of [0.5, 1.5]) looks.push({ start: c * 2 * rev + k * rev - ill / 2, length: ill, label: `Look ${looks.length + 1}` });
    } else {
      for (let l = 0; l < t.looks; l++) looks.push({ start: c * rev + l * line, length: ill, label: `Look ${looks.length + 1}` });
    }
  }
  const span = scan.pattern === "sector_bi" ? cycles * 2 * rev : cycles * rev;
  return { looks, span };
}

function niceStep(span: number) {
  const raw = span / 5;
  const p = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 5, 10].map((m) => m * p).find((s) => s >= raw) ?? raw;
}

/** When the beam is on a target over three revisits (on a hover, each look's times). */
export function IlluminationTimeline({ scan, timing }: { scan: Scan; timing: ScanTiming }) {
  const [hover, setHover] = useState<number | null>(null);
  const width = 800;
  const height = 64;
  const left = 8;
  const right = width - 8;
  const top = 14;
  const bar = 22;
  if (timing.continuous) {
    return (
      <figure className="scan-figure scan-timeline">
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Illuminated all the time">
          <rect x={left} y={top} width={right - left} height={bar} rx="4" fill={BEAM} fillOpacity="0.85" />
          <text x={(left + right) / 2} y={top + bar + 22} textAnchor="middle" fontSize="11" fill={INK}>
            On the target all the time
          </text>
        </svg>
        <figcaption>When the beam is on the target</figcaption>
      </figure>
    );
  }
  const { looks, span } = looksOf(scan, timing);
  if (!looks.length) {
    return (
      <figure className="scan-figure scan-timeline">
        <p className="hint-text">The timeline shows once the illumination time and revisit can be worked out.</p>
      </figure>
    );
  }
  const x = (s: number) => left + (s / span) * (right - left);
  const step = niceStep(span);
  const ticks = Array.from({ length: Math.floor(span / step) + 1 }, (_, i) => i * step);
  const shownLook = hover != null ? looks[hover] : null;
  return (
    <figure className="scan-figure scan-timeline">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="When the beam is on the target over three revisits">
        <line x1={left} x2={right} y1={top + bar} y2={top + bar} stroke="var(--viz-axis)" />
        {ticks.map((s) => (
          <g key={s}>
            <line x1={x(s)} x2={x(s)} y1={top + bar} y2={top + bar + 4} stroke="var(--viz-axis)" />
            <text x={x(s)} y={top + bar + 16} textAnchor={s === 0 ? "start" : "middle"} fontSize="10" fill={INK}>
              {num(s)} s
            </text>
          </g>
        ))}
        {looks.map((l, i) => {
          const w = Math.max(2, x(l.start + l.length) - x(l.start));
          return (
            <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              {/* A wider target than the mark, for the hover. */}
              <rect x={x(l.start) - 6} y={top - 4} width={w + 12} height={bar + 4} fill="transparent" />
              <rect x={x(l.start)} y={top} width={w} height={bar} rx={Math.min(4, w / 2)} fill={BEAM} fillOpacity={hover === i ? 1 : 0.8} />
            </g>
          );
        })}
      </svg>
      <figcaption>
        {shownLook
          ? `${shownLook.label}: ${num(shownLook.start)}–${num(shownLook.start + shownLook.length)} s (${num(shownLook.length * 1000)} ms on the target)`
          : `When the beam is on the target over three revisits${timing.looks > 1 ? ` — ${timing.looks} looks a frame` : ""}${scan.pattern === "sector_bi" ? " — a target mid-sector, seen out and back" : ""}`}
      </figcaption>
    </figure>
  );
}
