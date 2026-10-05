import type { ModeLine, PriType } from "../../types/domain";
import { frameTimeFromText } from "../common/frameTime";

/** Everything typed into a Mode's line, as the form holds it (text, so a
 * half-typed number isn't lost). A blank max means "same as min". */
export interface LineValues {
  priType: PriType;
  rfMin: string;
  rfMax: string;
  rfDelta: string;
  rfRange: boolean;
  priMin: string;
  priMax: string;
  priDelta: string;
  priRange: boolean;
  jitterMin: string;
  jitterMax: string;
  stagger: string;
  frameTimeDelta: string;
  pwMin: string;
  pwMax: string;
  pwDelta: string;
  pwRange: boolean;
}

/** A fresh line: deltas 0, jitter 0–1 µs, Fixed PRI. */
export const BLANK_LINE: LineValues = {
  priType: "fixed",
  rfMin: "",
  rfMax: "",
  rfDelta: "0",
  rfRange: false,
  priMin: "",
  priMax: "",
  priDelta: "0",
  priRange: false,
  jitterMin: "0",
  jitterMax: "1",
  stagger: "",
  frameTimeDelta: "0",
  pwMin: "",
  pwMax: "",
  pwDelta: "0",
  pwRange: false,
};

const str = (v: number | null | undefined, fallback = "") => (v == null ? fallback : String(v));

/** An existing Mode's line as form values. A max equal to its min shows blank
 * ("same as min"), as it would have been typed. */
export function lineValuesFrom(priType: PriType, line: ModeLine | null | undefined): LineValues {
  if (!line) return { ...BLANK_LINE, priType };
  const maxOrBlank = (min: number | null | undefined, max: number | null | undefined) =>
    max != null && min != null && Number(max) === Number(min) ? "" : str(max);
  return {
    priType,
    rfMin: str(line.rf_min_mhz),
    rfMax: maxOrBlank(line.rf_min_mhz, line.rf_max_mhz),
    rfDelta: str(line.rf_delta, "0"),
    rfRange: line.rf_range_matching,
    priMin: str(line.pri_min_us),
    priMax: maxOrBlank(line.pri_min_us, line.pri_max_us),
    priDelta: str(line.pri_delta, "0"),
    priRange: line.pri_range_matching,
    jitterMin: str(line.jitter_min_us, "0"),
    jitterMax: str(line.jitter_max_us, "1"),
    stagger: line.pri_stagger_values_us?.join(", ") ?? "",
    frameTimeDelta: str(line.frame_time_delta_us, "0"),
    pwMin: str(line.pw_min_us),
    pwMax: maxOrBlank(line.pw_min_us, line.pw_max_us),
    pwDelta: str(line.pw_delta, "0"),
    pwRange: line.pw_range_matching,
  };
}

/** Which row a problem belongs to, so it's shown there. */
export type LineRow = "rf" | "pri" | "jitter" | "stagger" | "pw";
/** Which box in the row is wrong, so only that one is outlined. */
export type LineBox = "min" | "max" | "delta" | "sequence" | "frame";

export interface LineProblem {
  message: string;
  box: LineBox;
}

const num = (s: string) => (s.trim() === "" ? NaN : Number(s));

/** Parsed sequence, or the first bit that isn't a number. */
export function parseStagger(text: string): { values: number[]; bad: string | null } {
  const parts = text
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const bad = parts.find((p) => !Number.isFinite(Number(p)));
  return { values: bad ? [] : parts.map(Number), bad: bad ?? null };
}

function checkRange(label: string, unit: string, minText: string, maxText: string, deltaText: string): LineProblem | null {
  if (minText.trim() === "") return { message: `Enter ${label}${maxText.trim() ? " min" : ""}`, box: "min" };
  const min = num(minText);
  if (!Number.isFinite(min)) return { message: `${label} min isn't a number`, box: "min" };
  if (maxText.trim() !== "") {
    const max = num(maxText);
    if (!Number.isFinite(max)) return { message: `${label} max isn't a number`, box: "max" };
    if (max < min) return { message: `${label} max (${fmt(max)} ${unit}) is below min (${fmt(min)} ${unit})`, box: "max" };
  }
  const delta = num(deltaText);
  if (!Number.isFinite(delta)) return { message: `The ${label} ± margin isn't a number (0 for none)`, box: "delta" };
  if (delta < 0) return { message: `The ${label} ± margin can't be negative`, box: "delta" };
  return null;
}

/** Everything wrong with the line, one problem per row, in plain words. */
export function lineProblems(v: LineValues, explicitFrameTime: number | null): Partial<Record<LineRow, LineProblem>> {
  const out: Partial<Record<LineRow, LineProblem>> = {};
  const rf = checkRange("RF", "MHz", v.rfMin, v.rfMax, v.rfDelta);
  if (rf) out.rf = rf;
  const pw = checkRange("PW", "µs", v.pwMin, v.pwMax, v.pwDelta);
  if (pw) out.pw = pw;
  if (v.priType === "fixed") {
    const pri = checkRange("PRI", "µs", v.priMin, v.priMax, v.priDelta);
    if (pri) out.pri = pri;
    const jMin = num(v.jitterMin);
    const jMax = num(v.jitterMax);
    if (!Number.isFinite(jMin)) out.jitter = { message: "Enter jitter min (0 for none)", box: "min" };
    else if (!Number.isFinite(jMax)) out.jitter = { message: "Enter jitter max (0 for none)", box: "max" };
    else if (jMax < jMin) out.jitter = { message: `Jitter max (${fmt(jMax)} µs) is below min (${fmt(jMin)} µs)`, box: "max" };
  } else if (v.priType === "stagger") {
    const { values, bad } = parseStagger(v.stagger);
    const delta = num(v.frameTimeDelta);
    if (bad) out.stagger = { message: `“${bad}” in the sequence isn't a number`, box: "sequence" };
    else if (values.length === 0) out.stagger = { message: "Enter the stagger sequence, e.g. 800, 850, 900", box: "sequence" };
    else if (values.some((x) => x <= 0)) out.stagger = { message: "Every step in the sequence must be above 0 µs", box: "sequence" };
    else if (!Number.isFinite(delta) || delta < 0) out.stagger = { message: "The frame time ± margin must be 0 or more", box: "delta" };
    else if (explicitFrameTime != null && explicitFrameTime <= 0) out.stagger = { message: "The frame time must be above 0 µs", box: "frame" };
  }
  return out;
}

/** The line as the API takes it; a blank max takes the min. Only call when
 * lineProblems is empty. */
export function linePayload(v: LineValues, explicitFrameTime: number | null) {
  const pair = (minText: string, maxText: string) => {
    const min = Number(minText);
    return [min, maxText.trim() === "" ? min : Number(maxText)] as const;
  };
  const [rfMin, rfMax] = pair(v.rfMin, v.rfMax);
  const [pwMin, pwMax] = pair(v.pwMin, v.pwMax);
  const fixed = v.priType === "fixed";
  const stagger = v.priType === "stagger";
  const [priMin, priMax] = fixed ? pair(v.priMin, v.priMax) : [undefined, undefined];
  return {
    rf_min_mhz: rfMin,
    rf_max_mhz: rfMax,
    rf_delta: Number(v.rfDelta),
    rf_range_matching: v.rfRange,
    pw_min_us: pwMin,
    pw_max_us: pwMax,
    pw_delta: Number(v.pwDelta),
    pw_range_matching: v.pwRange,
    pri_range_matching: v.priRange,
    pri_min_us: priMin,
    pri_max_us: priMax,
    pri_delta: fixed ? Number(v.priDelta) : undefined,
    jitter_min_us: fixed ? Number(v.jitterMin) : undefined,
    jitter_max_us: fixed ? Number(v.jitterMax) : undefined,
    pri_stagger_values_us: stagger ? parseStagger(v.stagger).values : undefined,
    frame_time_delta_us: stagger ? Number(v.frameTimeDelta) : undefined,
    explicit_frame_time_us: stagger ? explicitFrameTime : undefined,
  };
}

/** Up to 4 decimals, with thousands separators: 2,899.5. */
export function fmt(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

/** "Matches 2,899 – 3,101 MHz", or null until there's something to show. */
export function rangePreview(minText: string, maxText: string, deltaText: string, unit: string): string | null {
  const min = num(minText);
  if (!Number.isFinite(min)) return null;
  const max = maxText.trim() === "" ? min : num(maxText);
  const delta = deltaText.trim() === "" ? 0 : num(deltaText);
  if (!Number.isFinite(max) || !Number.isFinite(delta) || max < min || delta < 0) return null;
  const lo = Math.round((min - delta) * 1e4) / 1e4;
  const hi = Math.round((max + delta) * 1e4) / 1e4;
  return lo === hi ? `Matches exactly ${fmt(lo)} ${unit}` : `Matches ${fmt(lo)} – ${fmt(hi)} ${unit}`;
}

/** "4 steps · frame 3,330 µs · matches 3,320 – 3,340 µs". */
export function staggerPreview(text: string, frameTime: number, deltaText: string): string | null {
  const { values, bad } = parseStagger(text);
  if (bad || values.length === 0 || !(frameTime > 0)) return null;
  const delta = num(deltaText);
  const steps = `${values.length} step${values.length === 1 ? "" : "s"} · frame ${fmt(frameTime)} µs`;
  return Number.isFinite(delta) && delta > 0
    ? `${steps} · matches ${fmt(frameTime - delta)} – ${fmt(frameTime + delta)} µs`
    : steps;
}

/** The frame time a stagger line will use: the sum of its steps unless one is written in. */
export function frameTimeOf(text: string): number {
  return frameTimeFromText(parseStagger(text).values.join(","));
}

/** The first free "<prefix> <n>" among names already used — "Search 3" after
 * "Search 1" and "Search 2". */
export function nextFreeName(prefix: string, used: Iterable<string>): string {
  const taken = new Set(used);
  let n = 1;
  while (taken.has(`${prefix} ${n}`)) n++;
  return `${prefix} ${n}`;
}

/** The name to suggest after `last` was added: same prefix, next free number;
 * a name without a number gets " 2" (then onward). */
export function nameAfter(last: string, used: Iterable<string>): string {
  const m = last.match(/^(.*?)\s*(\d+)$/);
  const prefix = (m ? m[1] : last).trim() || last;
  return nextFreeName(prefix, used);
}
