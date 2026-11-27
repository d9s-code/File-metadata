/** A radar's pulses over time: a Mode's on its own (a Fixed PRI, a
 * stagger's steps), sent in pulse groups (N pulses, then off), or sequenced
 * in an operational mode's timeline with other Modes and off times. Pure,
 * so the planner and the pictures share it.
 *
 * Times in µs; one period, repeating. */

export interface TimelineStep {
  kind: "group" | "off";
  /** The Mode's name (a group's). */
  mode_name?: string;
  /** This Mode's own step (the one being looked at). */
  own?: boolean;
  /** A group: this many pulses — or for this long (ms). An off time: this long (ms). */
  pulses?: number | null;
  ms?: number | null;
  /** The group's Mode's gaps between pulses, µs: one for a Fixed PRI, a stagger's steps in order. */
  steps_us?: number[];
}

export interface Segment {
  start: number;
  end: number;
  kind: "group" | "off";
  /** Its Mode's name, for a group. */
  name?: string;
  own?: boolean;
}

export interface PulseTrain {
  /** The period it repeats with, µs. */
  periodUs: number;
  /** Every pulse in one period, µs from its start, in order, and whose. */
  pulses: { t: number; own: boolean; name?: string }[];
  /** The groups and off times, for drawing. */
  segments: Segment[];
}

/** More than this in one period isn't drawn or counted pulse by pulse. */
const MAX_PULSES = 20000;

/** A group of a Mode's pulses from `start`: `count` pulses (or as many as fit in `durationUs`), its gaps cycling. */
function group(start: number, steps: number[], count: number | null, durationUs: number | null) {
  const times: number[] = [];
  if (!steps.length || steps.some((s) => !(s > 0))) return { times, end: start + (durationUs ?? 0) };
  let t = start;
  let k = 0;
  const limit = durationUs != null ? start + durationUs : Infinity;
  while (times.length < MAX_PULSES && (count != null ? times.length < count : t < limit - 1e-9)) {
    times.push(t);
    t += steps[k % steps.length];
    k++;
  }
  return { times, end: durationUs != null ? limit : t };
}

/** A Mode's own pulses: its gaps (one, or a stagger's steps), continuously or in groups of `groupPulses` then off `groupOffMs`. */
export function modeTrain(stepsUs: number[], groupPulses?: number | null, groupOffMs?: number | null): PulseTrain | null {
  if (!stepsUs.length || stepsUs.some((s) => !(s > 0))) return null;
  if (groupPulses && groupPulses > 0 && groupOffMs != null) {
    const g = group(0, stepsUs, groupPulses, null);
    const periodUs = g.end + groupOffMs * 1000;
    return {
      periodUs,
      pulses: g.times.map((t) => ({ t, own: true })),
      segments: [
        { start: 0, end: g.end, kind: "group", own: true },
        ...(groupOffMs > 0 ? [{ start: g.end, end: periodUs, kind: "off" as const }] : []),
      ],
    };
  }
  const g = group(0, stepsUs, stepsUs.length, null);
  return { periodUs: g.end, pulses: g.times.map((t) => ({ t, own: true })), segments: [{ start: 0, end: g.end, kind: "group", own: true }] };
}

/** An operational mode's timeline, once round: each group's pulses, each off time. */
export function timelineTrain(steps: TimelineStep[]): PulseTrain | null {
  let t = 0;
  const pulses: PulseTrain["pulses"] = [];
  const segments: Segment[] = [];
  for (const s of steps) {
    if (s.kind === "off") {
      const end = t + (s.ms ?? 0) * 1000;
      if (end > t) segments.push({ start: t, end, kind: "off" });
      t = end;
      continue;
    }
    const g = group(t, s.steps_us ?? [], s.pulses ?? null, s.pulses == null && s.ms != null ? s.ms * 1000 : null);
    for (const p of g.times) pulses.push({ t: p, own: !!s.own, name: s.mode_name });
    if (g.end > t) segments.push({ start: t, end: g.end, kind: "group", name: s.mode_name, own: !!s.own });
    t = g.end;
  }
  if (!(t > 0)) return null;
  return { periodUs: t, pulses, segments };
}

/** How long a look must be to hold `k` of its own pulses wherever it starts, µs (Infinity: never). */
export function timeForPulses(train: PulseTrain, k: number): number {
  const own = train.pulses.filter((p) => p.own).map((p) => p.t);
  const n = own.length;
  if (!n || k < 1) return k < 1 ? 0 : Infinity;
  // Starting just after pulse i, the k-th next one comes at t[i + k] (going round the period).
  const at = (j: number) => own[j % n] + Math.floor(j / n) * train.periodUs;
  let worst = 0;
  for (let i = 0; i < n; i++) worst = Math.max(worst, at(i + k) - at(i));
  return worst;
}

/** The share of the time it transmits its own pulses (0–1). */
export function ownDuty(train: PulseTrain): number {
  const on = train.segments.filter((s) => s.kind === "group" && s.own).reduce((n, s) => n + s.end - s.start, 0);
  return train.periodUs > 0 ? Math.min(1, on / train.periodUs) : 0;
}
