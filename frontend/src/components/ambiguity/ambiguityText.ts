import type {
  AmbiguityFinding,
  AmbiguityRun,
  AmbiguitySeverity,
  ComparedSide,
  FindingModeSide,
  OverlapParam,
  ToleranceConfig,
} from "../../api/ambiguity";

export const PARAMS: { key: OverlapParam; label: string; unit: string }[] = [
  { key: "rf", label: "RF", unit: "MHz" },
  { key: "pri", label: "PRI", unit: "µs" },
  { key: "pw", label: "PW", unit: "µs" },
  { key: "jitter", label: "Jitter", unit: "µs" },
];

export const SEVERITY_ORDER: AmbiguitySeverity[] = ["exact_overlap", "high", "medium", "low"];
export const SEVERITY_RANK: Record<AmbiguitySeverity, number> = { exact_overlap: 0, high: 1, medium: 2, low: 3, none: 4 };
export const SEVERITY_LABEL: Record<AmbiguitySeverity, string> = {
  exact_overlap: "Exact",
  high: "High",
  medium: "Medium",
  low: "Low",
  none: "None",
};

export const DEFAULT_THRESHOLDS: ToleranceConfig = { low_threshold: 30, high_threshold: 70, exact_threshold: 99 };

export type FindingStatus = "open" | "acknowledged" | "merged";

export function findingStatus(f: AmbiguityFinding): FindingStatus {
  if (f.resolution) return "merged";
  return f.reviewed_at ? "acknowledged" : "open";
}

export function overlapPct(f: AmbiguityFinding, p: OverlapParam): number | null {
  if (p === "jitter") return f.details.jitter_overlap_pct ?? null;
  return p === "rf" ? f.rf_overlap_pct : p === "pw" ? f.pw_overlap_pct : f.pri_overlap_pct;
}

/** The PRI row's name: what PRI was compared on. */
export function priLabel(f: AmbiguityFinding): string {
  return f.details.pri_basis === "frame_time" ? "PRI frame time" : f.details.pri_basis === "steps" ? "PRI steps" : "PRI";
}

/** The parameter that overlaps least — the one that set the severity. */
export function limitingParam(f: AmbiguityFinding): OverlapParam {
  if (f.details.limiting) return f.details.limiting;
  return PARAMS.map((p) => p.key)
    .filter((k) => overlapPct(f, k) != null)
    .reduce((a, b) => ((overlapPct(f, b) as number) < (overlapPct(f, a) as number) ? b : a));
}

/** Whether this check compared ranges with their margins (checks made before
 * margins were used compared them as typed). */
export function marginsApplied(run: AmbiguityRun | undefined): boolean {
  return run?.tolerance_config?.apply_margins === true;
}

/** Whether this check used the current rules (PRI type, frame time, jitter). */
export function rulesCurrent(run: AmbiguityRun | undefined): boolean {
  return (run?.tolerance_config?.rules_version ?? 0) >= 2;
}

function typedSide(side: FindingModeSide): ComparedSide {
  const l = side.line;
  return {
    rf: [l.rf_min_mhz, l.rf_max_mhz],
    pw: [l.pw_min_us, l.pw_max_us],
    pri: l.pri_min_us != null && l.pri_max_us != null ? [l.pri_min_us, l.pri_max_us] : null,
    stagger: l.pri_stagger_values_us?.length ? l.pri_stagger_values_us : null,
  };
}

/** Each side's ranges as compared — recorded on newer findings, else the typed ones. */
export function comparedSides(f: AmbiguityFinding): { a: ComparedSide; b: ComparedSide } {
  const c = f.details.compared;
  return c ? { a: c.mode_a, b: c.mode_b } : { a: typedSide(f.details.mode_a), b: typedSide(f.details.mode_b) };
}

export function num(v: number): string {
  return Number.isInteger(v) ? v.toLocaleString() : v.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

export function rangeText(r: [number, number] | null | undefined): string {
  if (!r) return "—";
  return r[0] === r[1] ? num(r[0]) : `${num(r[0])}–${num(r[1])}`;
}

export function pct(v: number | null): string {
  return v == null ? "—" : `${Math.round(v * 10) / 10}%`;
}

/** The severity rule in words, for these thresholds. */
export function severityRule(t: ToleranceConfig): { severity: AmbiguitySeverity; text: string }[] {
  return [
    { severity: "exact_overlap", text: `every parameter overlaps at least ${t.exact_threshold}%` },
    { severity: "high", text: `the least-overlapping parameter is at ${t.high_threshold}% or more` },
    { severity: "medium", text: `it's between ${t.low_threshold}% and ${t.high_threshold}%` },
    { severity: "low", text: `it's under ${t.low_threshold}%` },
  ];
}

export function scopeName(type: string): string {
  return type === "mdf" ? "MDF" : type === "platform" ? "Platform" : "Emitter";
}
