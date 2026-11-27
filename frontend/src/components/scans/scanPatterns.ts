/** Scan patterns: what each needs, and how long its beam is on a target each
 * look (illumination time) and how often it comes back (revisit). Pure, so
 * it can be tested on its own; the dwell planner and the Scans card both use it.
 *
 * Angles in degrees, times in s (illumination in ms), as the form takes them.
 * Every value can carry a ±; the illumination and revisit are then the
 * lowest to highest over every combination of the ± ends. */

import type { EmitterScan } from "../../api/scans";

export type ScanPatternId =
  | "circular"
  | "sector_uni"
  | "sector_bi"
  | "raster"
  | "helical"
  | "spiral"
  | "palmer"
  | "palmer_raster"
  | "conical"
  | "lobe_switching"
  | "steady"
  | "esa"
  | "other";

export interface ScanField {
  key: string;
  label: string;
  unit: string;
  /** A count (bars, pulses…): whole numbers, no ±. */
  integer?: boolean;
  /** Not needed for the illumination time. */
  optional?: boolean;
  hint?: string;
}

export interface ScanPatternDef {
  id: ScanPatternId;
  name: string;
  group: "Mechanical" | "Composite" | "Electronic" | "Tracking" | "Other";
  /** What the pattern is, in a line. */
  about: string;
  /** Which beamwidths it needs. */
  beam: { az: boolean; el: boolean };
  fields: ScanField[];
  /** The formulas, as read. */
  formula: string;
}

const F = {
  period: { key: "period_s", label: "Rotation period", unit: "s", hint: "One full turn (60 ÷ rpm)" },
  sector: { key: "sector_deg", label: "Sector width", unit: "°" },
  sweep: { key: "sweep_s", label: "Sweep time", unit: "s", hint: "Across the sector, one way" },
  flyback: { key: "flyback_s", label: "Flyback", unit: "s", optional: true, hint: "Back to the start; empty: none" },
  bars: { key: "bars", label: "Bars", unit: "", integer: true, hint: "Elevation lines per frame" },
  barSpacing: { key: "bar_spacing_deg", label: "Bar spacing", unit: "°" },
  frame: { key: "frame_s", label: "Frame time", unit: "s", hint: "The whole pattern, once" },
  levels: { key: "levels", label: "Elevation levels", unit: "", integer: true, hint: "Turns before it starts again" },
  cone: { key: "cone_deg", label: "Cone width", unit: "°", hint: "The spiral's whole width" },
  turns: { key: "turns", label: "Turns per frame", unit: "", integer: true },
  nutationDeg: { key: "nutation_deg", label: "Nutation width", unit: "°", hint: "The small circle the beam draws" },
  nutationHz: { key: "nutation_hz", label: "Nutation rate", unit: "Hz", optional: true },
  rate: { key: "rate_hz", label: "Scan rate", unit: "Hz", optional: true, hint: "The modulation it puts on the signal" },
  pulses: { key: "pulses", label: "Pulses per dwell", unit: "", integer: true, optional: true, hint: "× the Mode's PRI; or a dwell time" },
  dwellMs: { key: "dwell_ms", label: "Dwell time", unit: "ms", optional: true, hint: "When not counted in pulses" },
  revisit: { key: "revisit_s", label: "Revisit time", unit: "s", hint: "Back to the same beam position" },
} satisfies Record<string, ScanField>;

export const SCAN_PATTERNS: ScanPatternDef[] = [
  {
    id: "circular",
    name: "Circular",
    group: "Mechanical",
    about: "Turns through 360° at a steady rate.",
    beam: { az: true, el: false },
    fields: [F.period],
    formula: "Illumination = azimuth beamwidth ÷ 360° × rotation period. Revisit = rotation period.",
  },
  {
    id: "sector_uni",
    name: "Sector, one way",
    group: "Mechanical",
    about: "Sweeps across a sector, then flies back and starts again.",
    beam: { az: true, el: false },
    fields: [F.sector, F.sweep, F.flyback],
    formula: "Illumination = azimuth beamwidth ÷ sector × sweep time. Revisit = sweep + flyback.",
  },
  {
    id: "sector_bi",
    name: "Sector, both ways",
    group: "Mechanical",
    about: "Sweeps back and forth across a sector (a target is seen on the way out and back).",
    beam: { az: true, el: false },
    fields: [F.sector, F.sweep],
    formula:
      "Illumination = azimuth beamwidth ÷ sector × sweep time. Revisit = the sweep time on average (from almost 0 to 2× at the sector's edges).",
  },
  {
    id: "raster",
    name: "Raster",
    group: "Mechanical",
    about: "Sweeps a sector line by line (bars), stepping in elevation between them.",
    beam: { az: true, el: true },
    fields: [F.sector, F.bars, F.barSpacing, F.frame],
    formula:
      "Per look = azimuth beamwidth ÷ sector × (frame ÷ bars). Looks per frame = elevation beamwidth ÷ bar spacing (1 to bars). Revisit = frame time.",
  },
  {
    id: "helical",
    name: "Helical",
    group: "Mechanical",
    about: "Turns through 360° while stepping up in elevation each turn.",
    beam: { az: true, el: false },
    fields: [F.period, F.levels],
    formula: "Illumination = azimuth beamwidth ÷ 360° × rotation period. Revisit = rotation period × levels.",
  },
  {
    id: "spiral",
    name: "Spiral",
    group: "Mechanical",
    about: "Spirals out from the centre of a cone, then starts again.",
    beam: { az: true, el: false },
    fields: [F.cone, F.turns, F.frame],
    formula: "Illumination ≈ frame time × (beamwidth ÷ cone width)² — the beam's share of the area. Revisit = frame time.",
  },
  {
    id: "palmer",
    name: "Palmer",
    group: "Composite",
    about: "A fast conical nutation on top of a circular scan: the beam draws small circles as it turns.",
    beam: { az: true, el: false },
    fields: [F.period, F.nutationDeg, F.nutationHz],
    formula:
      "Illumination = (azimuth beamwidth + nutation width) ÷ 360° × rotation period, modulated at the nutation rate. Revisit = rotation period.",
  },
  {
    id: "palmer_raster",
    name: "Palmer-raster",
    group: "Composite",
    about: "A conical nutation on top of a raster.",
    beam: { az: true, el: true },
    fields: [F.sector, F.bars, F.barSpacing, F.frame, F.nutationDeg, F.nutationHz],
    formula: "As a raster, with the nutation width added to both beamwidths.",
  },
  {
    id: "esa",
    name: "Electronic (ESA) dwell",
    group: "Electronic",
    about: "The beam jumps between positions and dwells on each for a number of pulses.",
    beam: { az: false, el: false },
    fields: [F.pulses, F.dwellMs, F.revisit],
    formula: "Illumination = pulses × the Mode's PRI (or the dwell time). Revisit = revisit time.",
  },
  {
    id: "conical",
    name: "Conical",
    group: "Tracking",
    about: "Tracking: the beam circles the target, which stays inside it.",
    beam: { az: false, el: false },
    fields: [F.rate],
    formula: "Illuminated all the time (amplitude-modulated at the scan rate).",
  },
  {
    id: "lobe_switching",
    name: "Lobe switching",
    group: "Tracking",
    about: "Tracking: the beam switches between lobes around the target.",
    beam: { az: false, el: false },
    fields: [F.rate],
    formula: "Illuminated all the time (switching at the scan rate).",
  },
  {
    id: "steady",
    name: "Steady (no scan)",
    group: "Tracking",
    about: "The beam stays on the target.",
    beam: { az: false, el: false },
    fields: [],
    formula: "Illuminated all the time.",
  },
  {
    id: "other",
    name: "Other",
    group: "Other",
    about: "Any other scan: type its illumination time and revisit in.",
    beam: { az: false, el: false },
    fields: [F.revisit],
    formula: "Illumination and revisit as typed in.",
  },
];

export const PATTERN_BY_ID = new Map(SCAN_PATTERNS.map((p) => [p.id, p]));
export const PATTERN_GROUPS = ["Mechanical", "Composite", "Electronic", "Tracking", "Other"] as const;

export function patternName(id: string): string {
  return PATTERN_BY_ID.get(id as ScanPatternId)?.name ?? id;
}

/** A value with its lowest and highest (equal without a ±). */
export interface Spread {
  nom: number;
  lo: number;
  hi: number;
}

export interface ScanTiming {
  /** Illumination time each look, ms (null: all the time, or not known). */
  illuminationMs: Spread | null;
  /** Time between looks, s (null: all the time, or not known). */
  revisitS: Spread | null;
  /** On the target all the time (tracking, steady). */
  continuous: boolean;
  /** Looks per revisit (a raster's bars over the target; 1 otherwise). */
  looks: number;
  /** The illumination was typed in, not worked out. */
  typed: boolean;
  /** The values it still needs to work them out. */
  missing: string[];
  /** The working, with the numbers ("2° ÷ 360° × 10 s = 55.6 ms"). */
  working: string[];
}

type Values = Record<string, number>;

/** Short numbers for the working: 55.5556 → "55.6", 10 → "10". */
export function num(v: number): string {
  if (!Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  const digits = a >= 100 ? 0 : a >= 10 ? 1 : a >= 1 ? 2 : 3;
  return String(Number(v.toFixed(digits)));
}

export function spreadText(s: Spread | null, unit: string): string {
  if (!s) return "—";
  if (Math.abs(s.hi - s.lo) < 1e-9 * Math.max(1, Math.abs(s.nom))) return `${num(s.nom)} ${unit}`;
  return `${num(s.nom)} ${unit} (${num(s.lo)}–${num(s.hi)})`;
}

interface Calc {
  ill: (v: Values) => number | null;
  rev: (v: Values) => number | null;
  looks?: (v: Values) => number;
}

const looksOf = (v: Values, el: number) => {
  const bars = Math.max(1, Math.round(v.bars ?? 1));
  if (!(v.bar_spacing_deg > 0) || !(el > 0)) return 1;
  return Math.min(bars, Math.max(1, Math.round(el / v.bar_spacing_deg)));
};

/** The formulas, by pattern; `v` holds the scan's values plus az, el (beamwidths) and pri_us (the Mode's average PRI). */
const CALC: Partial<Record<ScanPatternId, Calc>> = {
  circular: { ill: (v) => (v.az / 360) * v.period_s * 1000, rev: (v) => v.period_s },
  sector_uni: { ill: (v) => (v.az / v.sector_deg) * v.sweep_s * 1000, rev: (v) => v.sweep_s + (v.flyback_s ?? 0) },
  sector_bi: { ill: (v) => (v.az / v.sector_deg) * v.sweep_s * 1000, rev: (v) => v.sweep_s },
  raster: {
    ill: (v) => (v.az / v.sector_deg) * (v.frame_s / Math.max(1, Math.round(v.bars))) * 1000,
    rev: (v) => v.frame_s,
    looks: (v) => looksOf(v, v.el),
  },
  palmer_raster: {
    ill: (v) => ((v.az + v.nutation_deg) / v.sector_deg) * (v.frame_s / Math.max(1, Math.round(v.bars))) * 1000,
    rev: (v) => v.frame_s,
    looks: (v) => looksOf(v, v.el + v.nutation_deg),
  },
  helical: { ill: (v) => (v.az / 360) * v.period_s * 1000, rev: (v) => v.period_s * Math.max(1, Math.round(v.levels)) },
  spiral: { ill: (v) => v.frame_s * (v.az / v.cone_deg) ** 2 * 1000, rev: (v) => v.frame_s },
  palmer: { ill: (v) => ((v.az + v.nutation_deg) / 360) * v.period_s * 1000, rev: (v) => v.period_s },
  esa: {
    ill: (v) => (v.pulses > 0 && v.pri_us > 0 ? (v.pulses * v.pri_us) / 1000 : v.dwell_ms > 0 ? v.dwell_ms : null),
    rev: (v) => v.revisit_s,
  },
  other: { ill: () => null, rev: (v) => v.revisit_s },
};

/** What the scan's illumination time and revisit come to; `priUs` is the Mode's average PRI (for an ESA dwell in pulses). */
export function scanTiming(scan: Pick<EmitterScan, "pattern" | "params" | "beam_az_deg" | "beam_el_deg" | "illumination_ms">, priUs?: number | null): ScanTiming {
  const def = PATTERN_BY_ID.get(scan.pattern as ScanPatternId);
  const params = (scan.params ?? {}) as Values;
  const out: ScanTiming = { illuminationMs: null, revisitS: null, continuous: false, looks: 1, typed: false, missing: [], working: [] };
  if (!def) return out;
  if (def.group === "Tracking") {
    out.continuous = true;
    out.working.push("On the target all the time.");
    return out;
  }
  const calc = CALC[def.id]!;
  const base: Values = { ...params };
  if (scan.beam_az_deg != null) base.az = scan.beam_az_deg;
  if (scan.beam_el_deg != null) base.el = scan.beam_el_deg;
  if (priUs != null && priUs > 0) base.pri_us = priUs;

  // What's missing.
  for (const f of def.fields) if (!f.optional && !(base[f.key] >= 0 && Number.isFinite(base[f.key]))) out.missing.push(f.label);
  if (def.beam.az && !(base.az > 0)) out.missing.push("Azimuth beamwidth");
  if (def.id === "esa" && !(base.pulses > 0) && !(base.dwell_ms > 0)) out.missing.push("Pulses per dwell or dwell time");

  // The ± ends of each value that has one.
  const spread = def.fields.filter((f) => !f.integer && (params[`${f.key}_delta`] ?? 0) > 0).map((f) => f.key);
  const combos: Values[] = [{ ...base }];
  for (const key of spread) {
    const d = params[`${key}_delta`];
    for (const c of combos.slice()) {
      combos.push({ ...c, [key]: Math.max(0, base[key] - d) });
      c[key] = base[key] + d;
    }
  }
  const range = (f: (v: Values) => number | null): Spread | null => {
    const nom = f(base);
    if (nom == null || !Number.isFinite(nom)) return null;
    const all = [nom, ...combos.map(f).filter((x): x is number => x != null && Number.isFinite(x))];
    return { nom, lo: Math.min(...all), hi: Math.max(...all) };
  };

  const rev = out.missing.includes(F.revisit.label) ? null : range(calc.rev);
  out.revisitS = rev && rev.nom > 0 ? rev : null;
  out.looks = calc.looks ? calc.looks(base) : 1;
  if (scan.illumination_ms != null) {
    out.illuminationMs = { nom: scan.illumination_ms, lo: scan.illumination_ms, hi: scan.illumination_ms };
    out.typed = true;
    out.working.push(`Typed in: ${num(scan.illumination_ms)} ms.`);
  } else if (out.missing.filter((m) => m !== F.revisit.label).length === 0) {
    const ill = range(calc.ill);
    out.illuminationMs = ill && ill.nom > 0 ? ill : null;
  }
  if (def.id === "other" && scan.illumination_ms == null) out.missing.unshift("Illumination time");
  if (!out.typed) out.working.push(...workingOf(def.id, base, out));
  if (!out.typed && def.id === "esa" && base.pulses > 0 && !(base.pri_us > 0) && !out.illuminationMs)
    out.working.push(`${Math.round(base.pulses)} pulses × each Mode's PRI`);
  return out;
}

function workingOf(id: ScanPatternId, v: Values, t: ScanTiming): string[] {
  if (!t.illuminationMs) return [];
  const ill = `${num(t.illuminationMs.nom)} ms`;
  switch (id) {
    case "circular":
    case "helical":
      return [`${num(v.az)}° ÷ 360° × ${num(v.period_s)} s = ${ill}`];
    case "palmer":
      return [`(${num(v.az)}° + ${num(v.nutation_deg)}°) ÷ 360° × ${num(v.period_s)} s = ${ill}`];
    case "sector_uni":
    case "sector_bi":
      return [`${num(v.az)}° ÷ ${num(v.sector_deg)}° × ${num(v.sweep_s)} s = ${ill}`];
    case "raster":
    case "palmer_raster": {
      const w = id === "raster" ? `${num(v.az)}°` : `(${num(v.az)}° + ${num(v.nutation_deg)}°)`;
      const line = `${num(v.frame_s)} s ÷ ${Math.round(v.bars)} bars`;
      return [
        `${w} ÷ ${num(v.sector_deg)}° × ${line} = ${ill} per look`,
        `${t.looks} look${t.looks === 1 ? "" : "s"} per frame${v.el > 0 ? "" : " (no elevation beamwidth: 1)"}`,
      ];
    }
    case "spiral":
      return [`${num(v.frame_s)} s × (${num(v.az)}° ÷ ${num(v.cone_deg)}°)² ≈ ${ill}`];
    case "esa":
      return v.pulses > 0 && v.pri_us > 0
        ? [`${Math.round(v.pulses)} pulses × ${num(v.pri_us)} µs = ${ill}`]
        : [`Dwell time: ${ill}`];
    default:
      return [];
  }
}

/** For the list: the values, as read ("period 10 s ± 0.2, sector 90°"). */
export function paramsText(scan: Pick<EmitterScan, "pattern" | "params">): string {
  const def = PATTERN_BY_ID.get(scan.pattern as ScanPatternId);
  const params = (scan.params ?? {}) as Values;
  if (!def) return "";
  return def.fields
    .filter((f) => params[f.key] != null)
    .map((f) => {
      const d = params[`${f.key}_delta`];
      const unit = f.unit === "°" || !f.unit ? f.unit : ` ${f.unit}`;
      return `${f.label.toLowerCase()} ${num(params[f.key])}${unit}${d ? ` ± ${num(d)}` : ""}`;
    })
    .join(", ");
}

/** An ESA dwell in pulses depends on the Mode's PRI. */
export function needsPri(scan: Pick<EmitterScan, "pattern" | "params"> | null | undefined): boolean {
  return scan?.pattern === "esa" && ((scan.params as Values | null)?.pulses ?? 0) > 0;
}
