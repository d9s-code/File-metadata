/** Pulses on a time axis: a Mode's (with its PW, and the spread its PRI
 * range and jitter allow), its pulse groups, or an operational mode's
 * timeline — each Mode in its own colour, off times shaded. Hover a group
 * or an off time for its times. */
import { useState } from "react";
import type { PulseTrain } from "./pulseTrain";

const SERIES = ["var(--series-1)", "var(--series-2)", "var(--series-3)", "var(--series-4)", "var(--series-5)", "var(--series-6)", "var(--series-7)", "var(--series-8)"];
const INK = "var(--viz-ink-muted)";

/** "850 µs", "12.5 ms", "2.4 s". */
export function timeText(us: number): string {
  const r = (v: number) => String(Number(v.toFixed(v >= 100 ? 0 : v >= 10 ? 1 : 2)));
  if (us < 1000) return `${r(us)} µs`;
  if (us < 1_000_000) return `${r(us / 1000)} ms`;
  return `${r(us / 1_000_000)} s`;
}

function niceStep(span: number) {
  const raw = span / 6;
  const p = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 5, 10].map((m) => m * p).find((s) => s >= raw) ?? raw;
}

export function PulseTrainChart({
  train,
  pwUs,
  spreadUs,
  caption,
  label = "Pulses over time",
}: {
  train: PulseTrain;
  /** Its pulse width, µs (drawn at least a hairline). */
  pwUs?: number | null;
  /** How far each pulse may sit from where it's drawn, µs (a PRI range, jitter) — shaded. */
  spreadUs?: number | null;
  caption?: string;
  label?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const width = 800;
  const height = 92;
  const left = 8;
  const right = width - 8;
  const top = 20;
  const bar = 28;
  // At least eight gaps' worth, and the period once more where it's short, so it's seen repeating.
  const gaps = train.pulses.length > 1 ? train.periodUs / train.pulses.length : train.periodUs;
  const span = Math.min(Math.max(train.periodUs * (train.segments.length > 1 ? 1.35 : 1), gaps * 8), train.periodUs * 12);
  const x = (t: number) => left + (t / span) * (right - left);
  const cycles = Math.ceil(span / train.periodUs) + 1;
  // Its own pulses first colour; the other Modes the next, in the order they come (fixed, never by rank).
  const hasOwn = train.pulses.some((p) => p.own);
  const others = [...new Set(train.pulses.filter((p) => !p.own).map((p) => p.name ?? ""))];
  const colour = (p: { own: boolean; name?: string }) =>
    p.own ? SERIES[0] : SERIES[((hasOwn ? 1 : 0) + Math.max(0, others.indexOf(p.name ?? ""))) % SERIES.length];
  const legend = new Map<string, string>();
  for (const p of train.pulses) if (p.name && !legend.has(p.name)) legend.set(p.name, colour(p));
  const pw = pwUs && pwUs > 0 ? pwUs : 0;
  const step = niceStep(span);
  const ticks = Array.from({ length: Math.floor(span / step) + 1 }, (_, i) => i * step);
  const segs = Array.from({ length: cycles }, (_, c) => train.segments.map((s) => ({ ...s, start: s.start + c * train.periodUs, end: s.end + c * train.periodUs })))
    .flat()
    .filter((s) => s.start < span);
  const shown = hover != null ? segs[hover] : null;
  let drawn = 0;

  return (
    <figure className="pulse-figure">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
        {segs.map((s, i) =>
          s.kind === "off" ? (
            <g key={`o${i}`}>
              <rect x={x(s.start)} y={top - 6} width={Math.max(1, x(Math.min(s.end, span)) - x(s.start))} height={bar + 12} fill="var(--viz-grid)" opacity="0.6" />
              {x(Math.min(s.end, span)) - x(s.start) > 34 && (
                <text x={(x(s.start) + x(Math.min(s.end, span))) / 2} y={top + bar / 2 + 4} textAnchor="middle" fontSize="10" fill={INK}>
                  off
                </text>
              )}
            </g>
          ) : null,
        )}
        {Array.from({ length: cycles }, (_, c) =>
          train.pulses.map((p, i) => {
            const t = p.t + c * train.periodUs;
            if (t > span || drawn > 4000) return null;
            drawn++;
            const w = Math.max(1.5, x(t + pw) - x(t));
            const spread = spreadUs && spreadUs > 0 ? Math.max(0, x(t + spreadUs) - x(t)) : 0;
            return (
              <g key={`${c}-${i}`}>
                {spread > 1 && <rect x={x(t) - spread} y={top + 4} width={spread * 2 + w} height={bar - 8} fill={colour(p)} opacity="0.15" />}
                <rect x={x(t)} y={top} width={w} height={bar} fill={colour(p)} opacity={p.own ? 1 : 0.75} />
              </g>
            );
          }),
        )}
        {segs.map((s, i) => (
          <rect
            key={`h${i}`}
            x={x(s.start)}
            y={top - 8}
            width={Math.max(4, x(Math.min(s.end, span)) - x(s.start))}
            height={bar + 16}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          />
        ))}
        <line x1={left} x2={right} y1={top + bar + 6} y2={top + bar + 6} stroke="var(--viz-axis)" />
        {ticks.map((t) => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={top + bar + 6} y2={top + bar + 10} stroke="var(--viz-axis)" />
            <text x={x(t)} y={top + bar + 22} textAnchor={t === 0 ? "start" : "middle"} fontSize="10" fill={INK}>
              {timeText(t)}
            </text>
          </g>
        ))}
        {train.segments.length > 1 && train.periodUs < span && (
          <g>
            <line x1={x(train.periodUs)} x2={x(train.periodUs)} y1={4} y2={top + bar + 6} stroke={INK} strokeDasharray="3 3" />
            <text x={x(train.periodUs) + 4} y={12} fontSize="10" fill={INK}>
              repeats every {timeText(train.periodUs)}
            </text>
          </g>
        )}
      </svg>
      {legend.size > 1 && (
        <div className="pulse-legend">
          {[...legend].map(([name, c]) => (
            <span key={name}>
              <i style={{ background: c }} /> {name}
            </span>
          ))}
        </div>
      )}
      <figcaption>
        {shown
          ? shown.kind === "off"
            ? `Off: ${timeText(shown.start)}–${timeText(shown.end)} (${timeText(shown.end - shown.start)})`
            : `${shown.name ?? "Pulses"}: ${timeText(shown.start)}–${timeText(shown.end)} (${timeText(shown.end - shown.start)})`
          : caption}
      </figcaption>
    </figure>
  );
}
