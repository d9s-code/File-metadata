/** One Mode against the dwell cycle, over time: when the receiver is on its
 * RF (long enough to see it, or not), when the radar's beam is on the
 * Platform, when it transmits (on/off periods), and the intercepts — from
 * the worst starting moment, or any one picked. Where the looks keep missing
 * the beam, the cycle is in step with the scan (scan-on-scan). */
import { useMemo, useState } from "react";
import { modeTimeline, type PlannerDwell, type PlannerMode, type PlannerSettings } from "./dwellPlanner";
import { timeText } from "../pulses/PulseTrainChart";

const RECEIVER = "var(--series-1)";
const BEAM = "var(--series-2)";
const ON = "var(--series-4)";
const INK = "var(--viz-ink-muted)";

const msText = (ms: number) => timeText(ms * 1000);

function niceStep(span: number) {
  const raw = span / 8;
  const p = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 5, 10].map((m) => m * p).find((s) => s >= raw) ?? raw;
}

export function PlannerTimeline({ mode, dwells, bw, settings }: { mode: PlannerMode; dwells: PlannerDwell[]; bw: number; settings: PlannerSettings }) {
  const [phase, setPhase] = useState<number | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const worst = useMemo(() => modeTimeline(mode, dwells, bw, settings), [mode, dwells, bw, settings]);
  const shown = useMemo(() => (phase == null ? worst : modeTimeline(mode, dwells, bw, settings, phase)), [phase, worst, mode, dwells, bw, settings]);
  if (!shown || !worst) return <p className="hint-text">No dwells to play it against.</p>;
  const width = 1200;
  const left = 140;
  const right = width - 10;
  const rows = [
    { key: "receiver", label: "Receiver on its RF" },
    { key: "beam", label: shown.beams ? "Beam on the Platform" : "Beam: all the time" },
    ...(shown.on ? [{ key: "on", label: "Transmitting" }] : []),
  ];
  const rowH = 22;
  const top = 10;
  const axisY = top + rows.length * (rowH + 8);
  const height = axisY + 26;
  const x = (t: number) => left + (Math.min(Math.max(t, 0), shown.spanMs) / shown.spanMs) * (right - left);
  const y = (k: string) => top + rows.findIndex((r) => r.key === k) * (rowH + 8);
  const step = niceStep(shown.spanMs);
  const ticks = Array.from({ length: Math.floor(shown.spanMs / step) + 1 }, (_, i) => i * step);
  const w = (a: number, b: number) => Math.max(1, x(b) - x(a));
  const first = shown.hits[0];

  return (
    <div className="planner-timeline">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${mode.modeName} against the dwell cycle over time`}>
        {rows.map((r) => (
          <text key={r.key} x={left - 8} y={y(r.key) + rowH / 2 + 4} textAnchor="end" fontSize="11" fill={INK}>
            {r.label}
          </text>
        ))}
        {shown.receiver.map((l, i) => (
          <rect
            key={`r${i}`}
            x={x(l.start)}
            y={y("receiver")}
            width={w(l.start, l.start + l.length)}
            height={rowH}
            rx="2"
            fill={RECEIVER}
            opacity={l.enough ? 0.9 : 0.3}
            onMouseEnter={() => setHover(`Receiver on its RF ${msText(Math.max(0, l.start))}–${msText(l.start + l.length)}${l.enough ? "" : ` — too short for ${msText(shown.needMs)}`}`)}
            onMouseLeave={() => setHover(null)}
          />
        ))}
        {shown.beams ? (
          shown.beams.map(([a, b], i) => (
            <rect
              key={`b${i}`}
              x={x(a)}
              y={y("beam")}
              width={w(a, b)}
              height={rowH}
              rx="2"
              fill={BEAM}
              onMouseEnter={() => setHover(`Beam on the Platform ${msText(a)}–${msText(b)} (${msText(b - a)})`)}
              onMouseLeave={() => setHover(null)}
            />
          ))
        ) : (
          <rect x={left} y={y("beam")} width={right - left} height={rowH} rx="2" fill={BEAM} opacity="0.5" />
        )}
        {shown.on?.map(([a, b], i) => (
          <rect key={`o${i}`} x={x(a)} y={y("on")} width={w(a, b)} height={rowH} rx="2" fill={ON} opacity="0.8" onMouseEnter={() => setHover(`Transmitting ${msText(a)}–${msText(b)}`)} onMouseLeave={() => setHover(null)} />
        ))}
        {shown.hits.map((t, i) => (
          <g key={`h${i}`} onMouseEnter={() => setHover(`Intercept ${i + 1} at ${msText(t)}`)} onMouseLeave={() => setHover(null)}>
            <line x1={x(t)} x2={x(t)} y1={top - 4} y2={axisY} stroke="var(--text)" strokeWidth="1.5" strokeDasharray={i ? "2 3" : undefined} />
            <path d={`M${x(t)},${top - 4} l5,-6 h-10 z`} fill="var(--text)" />
            <rect x={x(t) - 6} y={top - 10} width={12} height={axisY - top + 10} fill="transparent" />
          </g>
        ))}
        <line x1={left} x2={right} y1={axisY} y2={axisY} stroke="var(--viz-axis)" />
        {ticks.map((t) => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={axisY} y2={axisY + 4} stroke="var(--viz-axis)" />
            <text x={x(t)} y={axisY + 16} textAnchor={t === 0 ? "start" : "middle"} fontSize="10" fill={INK}>
              {msText(t)}
            </text>
          </g>
        ))}
      </svg>
      <div className="planner-timeline-bar">
        <span className="pulse-legend">
          <span>
            <i style={{ background: RECEIVER }} /> Receiver on its RF (faint: too short)
          </span>
          <span>
            <i style={{ background: BEAM }} /> Beam on the Platform
          </span>
          {shown.on && (
            <span>
              <i style={{ background: ON }} /> Transmitting ({mode.onOffFrom}&apos;s on/off)
            </span>
          )}
          <span>▼ Intercept</span>
        </span>
        <label className="planner-phase">
          Starting moment
          <input type="range" min="0" max="71" value={phase ?? worst.phase} onChange={(e) => setPhase(Number(e.target.value))} aria-label="Starting moment" />
          <button type="button" className="link-button" disabled={phase == null} onClick={() => setPhase(null)}>
            Worst
          </button>
        </label>
      </div>
      <p className="hint-text planner-timeline-caption">
        {hover ??
          `${phase == null ? "The worst starting moment" : `Starting moment ${phase + 1} of 72`}: ${first != null ? `first intercept at ${msText(first)}` : `not intercepted in ${msText(shown.spanMs)}`} · the cycle is ${msText(shown.cycleMs)}${shown.periodMs ? `, the scan ${msText(shown.periodMs)}` : ""} · ${msText(shown.needMs)} needed on its RF.`}
      </p>
    </div>
  );
}
