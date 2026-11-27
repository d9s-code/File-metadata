/** A Mode's signal, pictured: its RF over time, its PRI and PW pulse to
 * pulse (each against its range, shaded), and what happens inside one pulse
 * (a chirp's frequency, a phase code's chips, FSK tones). Hover a point for
 * its values. Drawn from its ranges and its behaviour as typed. */
import type { ReactNode } from "react";
import { CODES, codePhases, pulses, type Modulation, type ModeSignal, type Ranges } from "./signal";

const MARK = "var(--series-1)";
const INK = "var(--viz-ink-muted)";
const BAND = "var(--viz-grid)";
const W = 360;
const H = 150;
const L = 52;
const R = W - 8;
const T = 12;
const B = H - 26;

const PRI_LABEL = { steady: "steady", sliding: "sliding", dwell_switch: "dwell & switch", random: "random" } as const;

const fmt = (v: number) => String(Number(v.toFixed(Math.abs(v) >= 100 ? 0 : Math.abs(v) >= 10 ? 1 : 2)));

function Panel({ title, children, x0, x1, y0, y1, xUnit, yUnit }: { title: string; children: ReactNode; x0: string; x1: string; y0: string; y1: string; xUnit: string; yUnit: string }) {
  return (
    <figure className="signal-panel">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title}>
        <line x1={L} x2={R} y1={B} y2={B} stroke="var(--viz-axis)" />
        <line x1={L} x2={L} y1={T} y2={B} stroke="var(--viz-axis)" />
        <text x={L - 4} y={T + 8} textAnchor="end" fontSize="10" fill={INK}>
          {y1}
        </text>
        <text x={L - 4} y={B} textAnchor="end" fontSize="10" fill={INK}>
          {y0}
        </text>
        <text x={4} y={(T + B) / 2} fontSize="10" fill={INK}>
          {yUnit}
        </text>
        <text x={L} y={H - 8} fontSize="10" fill={INK}>
          {x0}
        </text>
        <text x={R} y={H - 8} textAnchor="end" fontSize="10" fill={INK}>
          {x1}
        </text>
        <text x={(L + R) / 2} y={H - 8} textAnchor="middle" fontSize="10" fill={INK}>
          {xUnit}
        </text>
        {children}
      </svg>
      <figcaption>{title}</figcaption>
    </figure>
  );
}

/** A scale with a little room either side of [lo, hi]. */
function scale(lo: number, hi: number, a: number, b: number) {
  const pad = hi - lo > 0 ? (hi - lo) * 0.08 : Math.max(Math.abs(lo) * 0.05, 1);
  const l = lo - pad;
  const h = hi + pad;
  return { f: (v: number) => a + ((v - l) / (h - l)) * (b - a), lo: l, hi: h };
}

function Inside({ m, pwUs }: { m: Modulation | null | undefined; pwUs: number }) {
  const kind = m?.kind ?? "none";
  const xs = (k: number) => L + k * (R - L);
  if (kind === "lfm" || kind === "nlfm") {
    const bw = m?.bandwidth_mhz ?? 1;
    const ys = (f: number) => T + ((1 - (f + 0.5)) * (B - T));
    const pts = Array.from({ length: 61 }, (_, i) => {
      const k = i / 60;
      let u = kind === "nlfm" ? 0.5 + Math.tanh(4 * (k - 0.5)) / (2 * Math.tanh(2)) : k;
      if (m?.direction === "down") u = 1 - u;
      if (m?.direction === "triangle") u = 1 - Math.abs(2 * u - 1);
      return `${xs(k).toFixed(1)},${ys(u - 0.5).toFixed(1)}`;
    });
    return (
      <Panel title={`Inside a pulse: ${kind === "lfm" ? "linear" : "non-linear"} chirp over ${fmt(bw)} MHz${m?.direction ? `, ${m.direction}` : ""}`} x0="0" x1={`${fmt(pwUs)} µs`} xUnit="time in the pulse" y0={`−${fmt(bw / 2)}`} y1={`+${fmt(bw / 2)}`} yUnit="MHz">
        <polyline points={pts.join(" ")} fill="none" stroke={MARK} strokeWidth="2" />
      </Panel>
    );
  }
  if (kind === "phase") {
    const phases = codePhases(m?.code, m?.code_length ?? 13);
    const w = (R - L) / phases.length;
    const name = CODES.find((c) => c[0] === m?.code)?.[1] ?? "Phase";
    // A binary code (0° / 180°) reads as + and − chips either side of a line.
    if (phases.every((p) => p === 0 || p === 180)) {
      const mid = (T + B) / 2;
      const h = (B - T) / 2 - 4;
      return (
        <Panel title={`Inside a pulse: ${name} code, ${phases.length} chips${m?.chip_us ? ` of ${fmt(m.chip_us)} µs` : ""}`} x0="chip 1" x1={`chip ${phases.length}`} xUnit="" y0="−" y1="+" yUnit="phase">
          <line x1={L} x2={R} y1={mid} y2={mid} stroke="var(--viz-axis)" />
          {phases.map((p, i) => (
            <rect key={i} x={L + i * w + 0.5} y={p === 0 ? mid - h : mid} width={Math.max(1, w - 1)} height={h} fill={MARK}>
              <title>{`Chip ${i + 1}: ${p === 0 ? "+ (0°)" : "− (180°)"}`}</title>
            </rect>
          ))}
        </Panel>
      );
    }
    return (
      <Panel title={`Inside a pulse: ${name} code, ${phases.length} chips${m?.chip_us ? ` of ${fmt(m.chip_us)} µs` : ""}`} x0="chip 1" x1={`chip ${phases.length}`} xUnit="" y0="0°" y1="360°" yUnit="phase">
        {phases.map((p, i) => {
          const h = Math.max(2, (p / 360) * (B - T));
          return (
            <rect key={i} x={L + i * w + 0.5} y={B - h} width={Math.max(1, w - 1)} height={h} fill={MARK} opacity={p === 0 ? 0.35 : 0.9}>
              <title>{`Chip ${i + 1}: ${fmt(p)}°`}</title>
            </rect>
          );
        })}
      </Panel>
    );
  }
  if (kind === "fsk") {
    const n = Math.max(2, Math.min(m?.frequencies ?? 4, 64));
    const steps = Array.from({ length: n }, (_, i) => (i * 7) % n);
    const w = (R - L) / n;
    return (
      <Panel title={`Inside a pulse: FSK, ${n} frequencies`} x0="0" x1={`${fmt(pwUs)} µs`} xUnit="time in the pulse" y0="f1" y1={`f${n}`} yUnit="tone">
        {steps.map((s, i) => {
          const y = B - ((s + 0.5) / n) * (B - T);
          return <line key={i} x1={L + i * w} x2={L + (i + 1) * w} y1={y} y2={y} stroke={MARK} strokeWidth="3" />;
        })}
      </Panel>
    );
  }
  return (
    <Panel title={kind === "unknown" ? "Inside a pulse: modulated, kind unknown" : "Inside a pulse: unmodulated"} x0="0" x1={`${fmt(pwUs)} µs`} xUnit="time in the pulse" y0="" y1="" yUnit="">
      {kind === "none" ? (
        <line x1={L} x2={R} y1={(T + B) / 2} y2={(T + B) / 2} stroke={MARK} strokeWidth="2" />
      ) : (
        <text x={(L + R) / 2} y={(T + B) / 2} textAnchor="middle" fontSize="20" fill={INK}>
          ?
        </text>
      )}
    </Panel>
  );
}

export function SignalCharts({ signal, ranges }: { signal: ModeSignal | null; ranges: Ranges }) {
  const ps = pulses(signal, ranges, 96);
  if (!ps.length) return null;
  const tEnd = ps[ps.length - 1].t || 1;
  const xT = (t: number) => L + (t / tEnd) * (R - L);
  const xI = (i: number) => L + (i / (ps.length - 1)) * (R - L);
  const rfAll = ps.flatMap((p) => p.rf);
  const rfLo = Math.min(ranges.rf[0], ...rfAll);
  const rfHi = Math.max(ranges.rf[1], ...rfAll);
  const yRf = scale(rfLo, rfHi, B, T);
  const priAll = ps.map((p) => p.pri);
  const pLo = Math.min(...priAll, ...(ranges.pri ? [ranges.pri[0]] : []));
  const pHi = Math.max(...priAll, ...(ranges.pri ? [ranges.pri[1]] : []));
  const yPri = scale(pLo, pHi, B, T);
  const pwAll = ps.map((p) => p.pw);
  const wLo = Math.min(...pwAll, ...(ranges.pw ? [ranges.pw[0]] : []));
  const wHi = Math.max(...pwAll, ...(ranges.pw ? [ranges.pw[1]] : []));
  const yPw = scale(wLo, wHi, B, T);
  const rfKind = signal?.rf?.kind ?? "fixed";
  const channels = signal?.rf?.kind === "hopping" || signal?.rf?.kind === "diverse" ? (signal.rf.channels_mhz ?? []) : [];
  const outside = channels.filter((c) => c < ranges.rf[0] || c > ranges.rf[1]);
  const band = (y: (v: number) => number, lo: number, hi: number) => (
    <rect x={L} y={y(hi)} width={R - L} height={Math.max(1, y(lo) - y(hi))} fill={BAND} opacity="0.6" />
  );

  return (
    <div className="signal-charts">
      <Panel
        title={`RF over time — ${rfKind === "fixed" ? "fixed (drawn at the middle of its range)" : rfKind === "diverse" ? "on several channels at once" : rfKind}${outside.length ? ` · ${outside.length} channel(s) outside its range ⚠` : ""}`}
        x0="0"
        x1={`${fmt(tEnd / 1000)} ms`}
        xUnit="time"
        y0={fmt(yRf.lo)}
        y1={fmt(yRf.hi)}
        yUnit="MHz"
      >
        {band(yRf.f, ranges.rf[0], ranges.rf[1])}
        {channels.map((c) => (
          <line key={c} x1={L} x2={R} y1={yRf.f(c)} y2={yRf.f(c)} stroke={INK} strokeDasharray="2 3" opacity="0.5" />
        ))}
        {ps.flatMap((p, i) =>
          p.rf.map((f, k) => (
            <circle key={`${i}-${k}`} cx={xT(p.t)} cy={yRf.f(f)} r="2.2" fill={MARK}>
              <title>{`Pulse ${i + 1}: ${fmt(f)} MHz at ${fmt(p.t / 1000)} ms`}</title>
            </circle>
          )),
        )}
      </Panel>
      <Panel title={`PRI pulse to pulse — ${ranges.steps?.length ? "stagger" : PRI_LABEL[signal?.pri?.kind ?? "steady"]}`} x0="1" x1={String(ps.length)} xUnit="pulse" y0={fmt(yPri.lo)} y1={fmt(yPri.hi)} yUnit="µs">
        {ranges.pri && band(yPri.f, ranges.pri[0], ranges.pri[1])}
        <polyline points={ps.map((p, i) => `${xI(i).toFixed(1)},${yPri.f(p.pri).toFixed(1)}`).join(" ")} fill="none" stroke={MARK} strokeWidth="1" opacity="0.5" />
        {ps.map((p, i) => (
          <circle key={i} cx={xI(i)} cy={yPri.f(p.pri)} r="2" fill={MARK}>
            <title>{`Pulse ${i + 1}: PRI ${fmt(p.pri)} µs`}</title>
          </circle>
        ))}
      </Panel>
      <Panel title={`PW pulse to pulse — ${signal?.pw?.kind ?? "fixed"}`} x0="1" x1={String(ps.length)} xUnit="pulse" y0={fmt(yPw.lo)} y1={fmt(yPw.hi)} yUnit="µs">
        {ranges.pw && band(yPw.f, ranges.pw[0], ranges.pw[1])}
        {ps.map((p, i) => (
          <circle key={i} cx={xI(i)} cy={yPw.f(p.pw)} r="2" fill={MARK}>
            <title>{`Pulse ${i + 1}: PW ${fmt(p.pw)} µs`}</title>
          </circle>
        ))}
      </Panel>
      <Inside m={signal?.modulation} pwUs={ranges.pw ? ranges.pw[1] : 1} />
    </div>
  );
}
