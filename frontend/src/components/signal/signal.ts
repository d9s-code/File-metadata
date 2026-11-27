/** How a Mode's signal behaves beyond its ranges — RF, PRI and PW behaviour,
 * the modulation inside a pulse, polarisation — as stored, as typed, as
 * read, and pulse by pulse (for the pictures and the planner). Pure.
 * For analysis only: never exported. */

export interface RfBehaviour {
  kind: "fixed" | "agile" | "hopping" | "swept" | "diverse";
  channels_mhz?: number[];
  hop_pulses?: number | null;
  hop_ms?: number | null;
  order?: "sequence" | "random" | null;
  sweep_ms?: number | null;
  shape?: "sawtooth" | "triangle" | null;
}

export interface PriBehaviour {
  kind: "steady" | "sliding" | "wobulated" | "dwell_switch" | "random";
  period_ms?: number | null;
  shape?: "up" | "down" | "triangle" | null;
  values_us?: number[];
  dwell_pulses?: number | null;
}

export interface PwBehaviour {
  kind: "fixed" | "agile" | "sequence";
  values_us?: number[];
}

export type ModulationKind = "none" | "lfm" | "nlfm" | "phase" | "fsk" | "unknown";
export type PhaseCode = "barker" | "frank" | "p1" | "p2" | "p3" | "p4" | "polyphase" | "binary" | "other";

export interface Modulation {
  kind: ModulationKind;
  bandwidth_mhz?: number | null;
  direction?: "up" | "down" | "triangle" | null;
  code?: PhaseCode | null;
  code_length?: number | null;
  chip_us?: number | null;
  frequencies?: number | null;
}

export type Polarisation = "horizontal" | "vertical" | "circular_left" | "circular_right" | "slant" | "agile";

export interface ModeSignal {
  rf?: RfBehaviour | null;
  pri?: PriBehaviour | null;
  pw?: PwBehaviour | null;
  modulation?: Modulation | null;
  polarisation?: Polarisation | null;
}

export const RF_KINDS: [RfBehaviour["kind"], string][] = [
  ["fixed", "Fixed — one frequency in its range"],
  ["agile", "Agile — pulse to pulse, anywhere in its range"],
  ["hopping", "Hopping — over channels"],
  ["swept", "Swept — across its range"],
  ["diverse", "Diversity — several channels at once"],
];
export const PRI_KINDS: [PriBehaviour["kind"], string][] = [
  ["steady", "Steady — as its range says"],
  ["sliding", "Sliding — from one end to the other"],
  ["wobulated", "Wobulated — sinusoidally"],
  ["dwell_switch", "Dwell & switch — values in turn"],
  ["random", "Random — anywhere in its range"],
];
export const PW_KINDS: [PwBehaviour["kind"], string][] = [
  ["fixed", "Fixed — one PW in its range"],
  ["agile", "Agile — one of these at random"],
  ["sequence", "Sequence — these in turn"],
];
export const MOD_KINDS: [ModulationKind, string][] = [
  ["none", "None — unmodulated"],
  ["lfm", "Linear chirp (LFM)"],
  ["nlfm", "Non-linear chirp (NLFM)"],
  ["phase", "Phase code"],
  ["fsk", "Frequency-shift keyed (FSK)"],
  ["unknown", "Modulated, kind unknown"],
];
export const CODES: [PhaseCode, string][] = [
  ["barker", "Barker"],
  ["frank", "Frank"],
  ["p1", "P1"],
  ["p2", "P2"],
  ["p3", "P3"],
  ["p4", "P4"],
  ["polyphase", "Polyphase"],
  ["binary", "Binary"],
  ["other", "Other"],
];
export const POLARISATIONS: [Polarisation, string][] = [
  ["horizontal", "Horizontal"],
  ["vertical", "Vertical"],
  ["circular_left", "Circular (left)"],
  ["circular_right", "Circular (right)"],
  ["slant", "Slant"],
  ["agile", "Agile"],
];

// --- As typed ---------------------------------------------------------------

export interface SignalDraft {
  rfKind: RfBehaviour["kind"];
  channels: string;
  hopAmount: string;
  hopUnit: "pulses" | "ms";
  hopOrder: "sequence" | "random";
  sweepMs: string;
  sweepShape: "sawtooth" | "triangle";
  priKind: PriBehaviour["kind"];
  priPeriodMs: string;
  priShape: "up" | "down" | "triangle";
  priValues: string;
  priDwell: string;
  pwKind: PwBehaviour["kind"];
  pwValues: string;
  modKind: ModulationKind;
  bandwidth: string;
  direction: "up" | "down" | "triangle";
  code: PhaseCode;
  codeLength: string;
  chipUs: string;
  fskFrequencies: string;
  polarisation: Polarisation | "";
}

const s = (v: number | null | undefined) => (v == null ? "" : String(v));
const list = (v: number[] | undefined) => (v ?? []).join(", ");

export function signalDraftFrom(sig: ModeSignal | null | undefined): SignalDraft {
  const rf = sig?.rf;
  const pri = sig?.pri;
  const mod = sig?.modulation;
  return {
    rfKind: rf?.kind ?? "fixed",
    channels: list(rf?.channels_mhz),
    hopAmount: s(rf?.hop_pulses ?? rf?.hop_ms),
    hopUnit: rf?.hop_ms != null ? "ms" : "pulses",
    hopOrder: rf?.order ?? "sequence",
    sweepMs: s(rf?.sweep_ms),
    sweepShape: rf?.shape ?? "sawtooth",
    priKind: pri?.kind ?? "steady",
    priPeriodMs: s(pri?.period_ms),
    priShape: pri?.shape ?? "up",
    priValues: list(pri?.values_us),
    priDwell: s(pri?.dwell_pulses),
    pwKind: sig?.pw?.kind ?? "fixed",
    pwValues: list(sig?.pw?.values_us),
    modKind: mod?.kind ?? "none",
    bandwidth: s(mod?.bandwidth_mhz),
    direction: mod?.direction ?? "up",
    code: mod?.code ?? "barker",
    codeLength: s(mod?.code_length),
    chipUs: s(mod?.chip_us),
    fskFrequencies: s(mod?.frequencies),
    polarisation: sig?.polarisation ?? "",
  };
}

/** "9400, 9420 9440" → [9400, 9420, 9440] (null: something that isn't a number above 0). */
export function parseList(text: string): number[] | null {
  const parts = text.split(/[\s,;/]+/).filter(Boolean);
  const nums = parts.map(Number);
  return nums.every((n) => Number.isFinite(n) && n > 0) ? nums : null;
}

const num = (t: string) => (t.trim() === "" ? null : Number(t));
const positive = (t: string) => t.trim() !== "" && Number(t) > 0;
const whole = (t: string) => positive(t) && Number.isInteger(Number(t));

/** What's wrong in the draft, if anything; `fixedPri`: only a Fixed PRI has a PRI behaviour. */
export function signalProblem(d: SignalDraft, fixedPri: boolean): string | null {
  if (d.rfKind === "hopping" || d.rfKind === "diverse") {
    const ch = parseList(d.channels);
    if (!ch || ch.length < 2) return "RF: at least two channels (MHz), numbers above 0";
  }
  if (d.rfKind === "hopping" && !(d.hopUnit === "pulses" ? whole(d.hopAmount) : positive(d.hopAmount)))
    return `RF: how long a hop lasts (${d.hopUnit === "pulses" ? "a whole number of pulses" : "ms"})`;
  if (d.rfKind === "swept" && !positive(d.sweepMs)) return "RF: the sweep time (ms)";
  if (fixedPri) {
    if ((d.priKind === "sliding" || d.priKind === "wobulated") && !positive(d.priPeriodMs)) return "PRI: its period (ms)";
    if (d.priKind === "dwell_switch") {
      const v = parseList(d.priValues);
      if (!v || v.length < 2) return "PRI: at least two values (µs)";
      if (!whole(d.priDwell)) return "PRI: the dwell, a whole number of pulses";
    }
  }
  if (d.pwKind !== "fixed") {
    const v = parseList(d.pwValues);
    if (!v || v.length < 2) return "PW: at least two values (µs)";
  }
  if ((d.modKind === "lfm" || d.modKind === "nlfm") && !positive(d.bandwidth)) return "Modulation: the chirp's bandwidth (MHz)";
  if (d.modKind === "phase" && !(whole(d.codeLength) && Number(d.codeLength) >= 2)) return "Modulation: the code's length (chips, 2 or more)";
  if (d.modKind === "phase" && d.chipUs.trim() && !positive(d.chipUs)) return "Modulation: the chip length, above 0";
  if (d.modKind === "fsk" && !(whole(d.fskFrequencies) && Number(d.fskFrequencies) >= 2)) return "Modulation: the number of frequencies (2 or more)";
  return null;
}

/** The draft as stored: only what isn't plain; null when nothing is. Assumes no problem. */
export function signalPayload(d: SignalDraft, fixedPri: boolean): ModeSignal | null {
  const out: ModeSignal = {};
  if (d.rfKind === "agile") out.rf = { kind: "agile" };
  if (d.rfKind === "hopping")
    out.rf = {
      kind: "hopping",
      channels_mhz: parseList(d.channels) ?? [],
      ...(d.hopUnit === "pulses" ? { hop_pulses: Number(d.hopAmount) } : { hop_ms: Number(d.hopAmount) }),
      order: d.hopOrder,
    };
  if (d.rfKind === "swept") out.rf = { kind: "swept", sweep_ms: Number(d.sweepMs), shape: d.sweepShape };
  if (d.rfKind === "diverse") out.rf = { kind: "diverse", channels_mhz: parseList(d.channels) ?? [] };
  if (fixedPri) {
    if (d.priKind === "sliding") out.pri = { kind: "sliding", period_ms: Number(d.priPeriodMs), shape: d.priShape };
    if (d.priKind === "wobulated") out.pri = { kind: "wobulated", period_ms: Number(d.priPeriodMs) };
    if (d.priKind === "dwell_switch") out.pri = { kind: "dwell_switch", values_us: parseList(d.priValues) ?? [], dwell_pulses: Number(d.priDwell) };
    if (d.priKind === "random") out.pri = { kind: "random" };
  }
  if (d.pwKind !== "fixed") out.pw = { kind: d.pwKind, values_us: parseList(d.pwValues) ?? [] };
  if (d.modKind === "lfm" || d.modKind === "nlfm") out.modulation = { kind: d.modKind, bandwidth_mhz: Number(d.bandwidth), direction: d.direction };
  if (d.modKind === "phase")
    out.modulation = { kind: "phase", code: d.code, code_length: Number(d.codeLength), ...(num(d.chipUs) != null ? { chip_us: Number(d.chipUs) } : {}) };
  if (d.modKind === "fsk") out.modulation = { kind: "fsk", frequencies: Number(d.fskFrequencies) };
  if (d.modKind === "unknown") out.modulation = { kind: "unknown" };
  if (d.polarisation) out.polarisation = d.polarisation;
  return Object.keys(out).length ? out : null;
}

// --- As read -----------------------------------------------------------------

const n = (v: number) => String(Number(v.toFixed(3)));
const listText = (v: number[] = [], unit: string) => `${v.slice(0, 8).map(n).join("/")}${v.length > 8 ? "…" : ""} ${unit}`;

/** "RF hopping, 4 ch · PRI sliding · LFM 5 MHz · H" — short, for a table. */
export function signalShort(sig: ModeSignal | null | undefined): string | null {
  if (!sig) return null;
  const parts: string[] = [];
  const rf = sig.rf;
  if (rf?.kind === "agile") parts.push("RF agile");
  if (rf?.kind === "hopping") parts.push(`RF hopping, ${rf.channels_mhz?.length ?? 0} ch`);
  if (rf?.kind === "swept") parts.push("RF swept");
  if (rf?.kind === "diverse") parts.push(`RF diversity, ${rf.channels_mhz?.length ?? 0} ch`);
  const pri = sig.pri;
  if (pri?.kind === "sliding") parts.push("PRI sliding");
  if (pri?.kind === "wobulated") parts.push("PRI wobulated");
  if (pri?.kind === "dwell_switch") parts.push(`PRI D&S ×${pri.values_us?.length ?? 0}`);
  if (pri?.kind === "random") parts.push("PRI random");
  if (sig.pw && sig.pw.kind !== "fixed") parts.push(`PW ${sig.pw.kind} ×${sig.pw.values_us?.length ?? 0}`);
  const m = sig.modulation;
  if (m?.kind === "lfm" || m?.kind === "nlfm") parts.push(`${m.kind.toUpperCase()} ${n(m.bandwidth_mhz ?? 0)} MHz`);
  if (m?.kind === "phase") parts.push(`${CODES.find((c) => c[0] === m.code)?.[1] ?? "Phase"} ${m.code_length}`);
  if (m?.kind === "fsk") parts.push(`FSK ${m.frequencies}`);
  if (m?.kind === "unknown") parts.push("modulated");
  if (sig.polarisation) parts.push(POLARISATIONS.find((p) => p[0] === sig.polarisation)?.[1] ?? sig.polarisation);
  return parts.length ? parts.join(" · ") : null;
}

/** The longer reading, as the version compare gives it. */
export function signalText(sig: ModeSignal | null | undefined): string | null {
  if (!sig) return null;
  const parts: string[] = [];
  const rf = sig.rf;
  if (rf?.kind === "agile") parts.push("RF agile, pulse to pulse");
  if (rf?.kind === "hopping")
    parts.push(
      `RF hopping over ${rf.channels_mhz?.length} channels (${listText(rf.channels_mhz, "MHz")}), a hop every ${rf.hop_pulses ? `${rf.hop_pulses} pulses` : `${n(rf.hop_ms ?? 0)} ms`}${rf.order === "random" ? " at random" : ""}`,
    );
  if (rf?.kind === "swept") parts.push(`RF swept in ${n(rf.sweep_ms ?? 0)} ms${rf.shape === "triangle" ? " (triangle)" : ""}`);
  if (rf?.kind === "diverse") parts.push(`RF on ${rf.channels_mhz?.length} channels at once (${listText(rf.channels_mhz, "MHz")})`);
  const pri = sig.pri;
  if (pri?.kind === "sliding") parts.push(`PRI sliding ${pri.shape ?? "up"} over ${n(pri.period_ms ?? 0)} ms`);
  if (pri?.kind === "wobulated") parts.push(`PRI wobulated over ${n(pri.period_ms ?? 0)} ms`);
  if (pri?.kind === "dwell_switch") parts.push(`PRI dwell & switch ${listText(pri.values_us, "µs")}, ${pri.dwell_pulses} pulses each`);
  if (pri?.kind === "random") parts.push("PRI random in its range");
  if (sig.pw && sig.pw.kind !== "fixed") parts.push(`PW ${sig.pw.kind === "agile" ? "agile" : "in sequence"} ${listText(sig.pw.values_us, "µs")}`);
  const short = signalShort({ modulation: sig.modulation, polarisation: sig.polarisation });
  if (short) parts.push(short);
  return parts.length ? parts.join(" · ") : null;
}

// --- Pulse by pulse ------------------------------------------------------------

/** Repeatable "random" numbers (the same picture every time it's drawn). */
function rng(seed: number) {
  let x = seed >>> 0 || 1;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return ((x >>> 0) % 100000) / 100000;
  };
}

export interface SignalPulse {
  /** When it starts, µs. */
  t: number;
  /** Its frequency (each, for diversity), MHz. */
  rf: number[];
  /** The gap to the next one, µs. */
  pri: number;
  pw: number;
}

export interface Ranges {
  rf: [number, number];
  /** A Fixed PRI's range (µs), or null (a stagger's steps go in `steps`). */
  pri: [number, number] | null;
  /** A stagger's steps, µs. */
  steps?: number[] | null;
  pw: [number, number] | null;
}

/** A Mode's ranges, from its line as typed (raw, without deltas). */
export function rangesOf(
  priType: string,
  line: { rf_min_mhz?: number | null; rf_max_mhz?: number | null; pri_min_us?: number | null; pri_max_us?: number | null; pri_stagger_values_us?: number[] | null; pw_min_us?: number | null; pw_max_us?: number | null },
): Ranges | null {
  if (line.rf_min_mhz == null) return null;
  const rf: [number, number] = [line.rf_min_mhz, line.rf_max_mhz ?? line.rf_min_mhz];
  const pri: [number, number] | null = priType === "fixed" && line.pri_min_us != null ? [line.pri_min_us, line.pri_max_us ?? line.pri_min_us] : null;
  const pw: [number, number] | null = line.pw_min_us != null ? [line.pw_min_us, line.pw_max_us ?? line.pw_min_us] : null;
  return { rf, pri, steps: priType === "stagger" ? (line.pri_stagger_values_us ?? null) : null, pw };
}

/** The first `count` pulses, as the signal behaves. */
export function pulses(sig: ModeSignal | null | undefined, r: Ranges, count = 96): SignalPulse[] {
  const rand = rng(7919);
  const out: SignalPulse[] = [];
  const [rfLo, rfHi] = r.rf;
  const priMid = r.pri ? (r.pri[0] + r.pri[1]) / 2 : null;
  const steps = r.steps?.length ? r.steps : null;
  const pwMid = r.pw ? (r.pw[0] + r.pw[1]) / 2 : 1;
  let t = 0;
  let hopChannel = 0;
  let lastHop = -1;
  for (let i = 0; i < count; i++) {
    // PRI
    let pri = steps ? steps[i % steps.length] : (priMid ?? 1000);
    const p = sig?.pri;
    if (r.pri && p && !steps) {
      const [lo, hi] = r.pri;
      const period = (p.period_ms ?? 1) * 1000;
      const phase = (t % period) / period;
      if (p.kind === "sliding") {
        const f = p.shape === "down" ? 1 - phase : p.shape === "triangle" ? 1 - Math.abs(2 * phase - 1) : phase;
        pri = lo + (hi - lo) * f;
      } else if (p.kind === "wobulated") pri = (lo + hi) / 2 + ((hi - lo) / 2) * Math.sin(2 * Math.PI * phase);
      else if (p.kind === "dwell_switch" && p.values_us?.length) pri = p.values_us[Math.floor(i / Math.max(1, p.dwell_pulses ?? 1)) % p.values_us.length];
      else if (p.kind === "random") pri = lo + (hi - lo) * rand();
    }
    // RF
    let rf = [(rfLo + rfHi) / 2];
    const f = sig?.rf;
    if (f?.kind === "agile") rf = [rfLo + (rfHi - rfLo) * rand()];
    else if (f?.kind === "swept" && f.sweep_ms) {
      const ph = (t % (f.sweep_ms * 1000)) / (f.sweep_ms * 1000);
      rf = [rfLo + (rfHi - rfLo) * (f.shape === "triangle" ? 1 - Math.abs(2 * ph - 1) : ph)];
    } else if (f?.kind === "hopping" && f.channels_mhz?.length) {
      const hopIndex = f.hop_pulses ? Math.floor(i / f.hop_pulses) : Math.floor(t / ((f.hop_ms ?? 1) * 1000));
      if (hopIndex !== lastHop) {
        lastHop = hopIndex;
        hopChannel = f.order === "random" ? Math.floor(rand() * f.channels_mhz.length) : hopIndex % f.channels_mhz.length;
      }
      rf = [f.channels_mhz[hopChannel]];
    } else if (f?.kind === "diverse" && f.channels_mhz?.length) rf = f.channels_mhz;
    // PW
    let pw = pwMid;
    const w = sig?.pw;
    if (w?.values_us?.length && w.kind === "agile") pw = w.values_us[Math.floor(rand() * w.values_us.length)];
    if (w?.values_us?.length && w.kind === "sequence") pw = w.values_us[i % w.values_us.length];
    out.push({ t, rf, pri, pw });
    t += pri;
  }
  return out;
}

/** A phase code's phases (degrees), chip by chip. */
export function codePhases(code: PhaseCode | null | undefined, length: number): number[] {
  const N = Math.max(2, Math.min(length, 400));
  const barker: Record<number, string> = { 2: "+-", 3: "++-", 4: "++-+", 5: "+++-+", 7: "+++--+-", 11: "+++---+--+-", 13: "+++++--++-+-+" };
  if (code === "barker" && barker[N]) return [...barker[N]].map((c) => (c === "+" ? 0 : 180));
  if (code === "frank") {
    const M = Math.max(2, Math.round(Math.sqrt(N)));
    return Array.from({ length: M * M }, (_, k) => ((360 * Math.floor(k / M) * (k % M)) / M) % 360);
  }
  const wrap = (d: number) => ((d % 360) + 360) % 360;
  if (code === "p1" || code === "p2" || code === "p3" || code === "polyphase") return Array.from({ length: N }, (_, k) => wrap((180 * k * k) / N));
  if (code === "p4") return Array.from({ length: N }, (_, k) => wrap((180 * k * k) / N - 180 * k));
  const rand = rng(31337 + N);
  return Array.from({ length: N }, () => (rand() < 0.5 ? 0 : 180));
}

/** For the planner: the share of its pulses a band of [lo, hi] MHz sees (1: all, a fixed RF in it — handled as a range elsewhere). */
export function shareInBand(sig: ModeSignal | null | undefined, rf: [number, number], lo: number, hi: number): number | null {
  const f = sig?.rf;
  if (!f || f.kind === "fixed") return null;
  if (f.kind === "hopping" || f.kind === "diverse") {
    const ch = f.channels_mhz ?? [];
    if (!ch.length) return null;
    const inBand = ch.filter((c) => c >= lo - 1e-9 && c <= hi + 1e-9).length;
    return f.kind === "diverse" ? (inBand ? 1 : 0) : inBand / ch.length;
  }
  // Agile or swept: spread across its range.
  const width = rf[1] - rf[0];
  if (!(width > 0)) return lo <= rf[0] && rf[0] <= hi ? 1 : 0;
  return Math.max(0, Math.min(hi, rf[1]) - Math.max(lo, rf[0])) / width;
}
