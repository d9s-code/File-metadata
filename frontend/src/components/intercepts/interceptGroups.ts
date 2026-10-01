/** Grouping imported reports into Intercept entries. Every change here is
 * one the user asked for — nothing is grouped until they merge reports or
 * press Auto group, and Auto group follows the one rule described in
 * AUTO_GROUP_RULE, with the tolerances they set. */
import type { CsvReport, ReportPriType } from "./interceptCsv";
import type { InterceptEntryInput } from "../../api/intercepts";

export interface ReportGroup {
  /** Stable for React keys; the lowest line number in the group. */
  id: number;
  /** Line numbers of its reports, in file order. */
  lines: number[];
  excluded: boolean;
}

export interface Tolerances {
  rfMhz: number;
  /** PRI, or for a stagger its frame time and each position. */
  priUs: number;
  pwUs: number;
  sameTrack: boolean;
}

export const AUTO_GROUP_RULE =
  "Takes the included reports from lowest to highest RF. Each one joins the first group it fits — same PRI type " +
  "(and, for a stagger, the same number of positions), and within the tolerances of every report already in the " +
  "group: RF, PRI (a stagger's frame time and each position) and PW. With \"same track number\" ticked it must " +
  "also share the track number. Otherwise it starts a new group. So no two reports in a group differ by more " +
  "than the tolerances. Time, power, jitter and the system's identification aren't used. Excluded reports are " +
  "left as they are. It replaces the current grouping; you can merge, split and exclude afterwards.";

/** One group per report — where an import starts. */
export function oneGroupPerReport(reports: CsvReport[], excluded = new Set<number>()): ReportGroup[] {
  return reports.map((r) => ({ id: r.line, lines: [r.line], excluded: excluded.has(r.line) }));
}

function makeGroup(lines: number[], excluded: boolean): ReportGroup {
  const sorted = [...lines].sort((a, b) => a - b);
  return { id: sorted[0], lines: sorted, excluded };
}

/** Why these reports can't be one entry, or null if they can. */
export function cannotMerge(reports: CsvReport[]): string | null {
  if (reports.length < 2) return "Select at least two rows to merge.";
  const types = new Set(reports.map((r) => r.priType));
  if (types.size > 1) return "These have different PRI types — an entry has one.";
  if (reports[0].priType === "stagger") {
    const counts = new Set(reports.map((r) => r.staggerUs?.length ?? 0));
    if (counts.size > 1) return "These staggers have different numbers of positions.";
  }
  return null;
}

/** The selected groups become one. */
export function mergeGroups(groups: ReportGroup[], ids: Set<number>): ReportGroup[] {
  const picked = groups.filter((g) => ids.has(g.id));
  const merged = makeGroup(
    picked.flatMap((g) => g.lines),
    picked.every((g) => g.excluded),
  );
  return [...groups.filter((g) => !ids.has(g.id)), merged];
}

/** The selected groups go back to one group per report. */
export function splitGroups(groups: ReportGroup[], ids: Set<number>): ReportGroup[] {
  return groups.flatMap((g) => (ids.has(g.id) ? g.lines.map((l) => makeGroup([l], g.excluded)) : [g]));
}

/** One report leaves its group and becomes its own. */
export function takeOut(groups: ReportGroup[], groupId: number, line: number): ReportGroup[] {
  return groups.flatMap((g) => {
    if (g.id !== groupId || g.lines.length < 2) return [g];
    return [makeGroup(g.lines.filter((l) => l !== line), g.excluded), makeGroup([line], g.excluded)];
  });
}

export function setExcluded(groups: ReportGroup[], ids: Set<number>, excluded: boolean): ReportGroup[] {
  return groups.map((g) => (ids.has(g.id) ? { ...g, excluded } : g));
}

interface Span {
  min: number;
  max: number;
}
const widen = (s: Span, v: number): Span => ({ min: Math.min(s.min, v), max: Math.max(s.max, v) });
const fits = (s: Span | null, v: number | null, tol: number) =>
  s == null || v == null || Math.max(s.max, v) - Math.min(s.min, v) <= tol + 1e-9;

interface Building {
  lines: number[];
  priType: ReportPriType;
  positions: number;
  track: string | null;
  rf: Span;
  pri: Span | null;
  pw: Span | null;
  stagger: Span[];
}

/** See AUTO_GROUP_RULE. Excluded groups are kept as they are. */
export function autoGroup(reports: CsvReport[], groups: ReportGroup[], tol: Tolerances): ReportGroup[] {
  const excludedGroups = groups.filter((g) => g.excluded);
  const excludedLines = new Set(excludedGroups.flatMap((g) => g.lines));
  const included = reports.filter((r) => !excludedLines.has(r.line)).sort((a, b) => a.rfMhz - b.rfMhz || a.line - b.line);

  const building: Building[] = [];
  // Reports come in rising RF and groups are opened in rising RF, so once a
  // group's lowest RF is more than the RF tolerance below this report it can
  // never take this or any later report — skip past it. Keeps large files fast.
  let firstOpen = 0;
  for (const r of included) {
    const positions = r.staggerUs?.length ?? 0;
    while (firstOpen < building.length && building[firstOpen].rf.min < r.rfMhz - tol.rfMhz - 1e-9) firstOpen++;
    let home: Building | undefined;
    for (let i = firstOpen; i < building.length && !home; i++) {
      const b = building[i];
      if (
        b.priType === r.priType &&
        b.positions === positions &&
        (!tol.sameTrack || b.track === r.track) &&
        fits(b.rf, r.rfMhz, tol.rfMhz) &&
        fits(b.pri, r.priUs, tol.priUs) &&
        fits(b.pw, r.pwUs, tol.pwUs) &&
        b.stagger.every((s, k) => fits(s, r.staggerUs?.[k] ?? null, tol.priUs))
      )
        home = b;
    }
    if (home) {
      home.lines.push(r.line);
      home.rf = widen(home.rf, r.rfMhz);
      if (home.pri && r.priUs != null) home.pri = widen(home.pri, r.priUs);
      if (home.pw && r.pwUs != null) home.pw = widen(home.pw, r.pwUs);
      home.stagger = home.stagger.map((s, i) => widen(s, r.staggerUs?.[i] ?? s.min));
    } else {
      building.push({
        lines: [r.line],
        priType: r.priType,
        positions,
        track: r.track,
        rf: { min: r.rfMhz, max: r.rfMhz },
        pri: r.priUs == null ? null : { min: r.priUs, max: r.priUs },
        pw: r.pwUs == null ? null : { min: r.pwUs, max: r.pwUs },
        stagger: (r.staggerUs ?? []).map((v) => ({ min: v, max: v })),
      });
    }
  }
  return [...building.map((b) => makeGroup(b.lines, false)), ...excludedGroups];
}

const round3 = (v: number) => Math.round(v * 1000) / 1000;
const mean = (vs: number[]) => round3(vs.reduce((a, b) => a + b, 0) / vs.length);

export interface Measured {
  mean: number;
  min: number;
  max: number;
}
function measure(vs: (number | null)[]): Measured | null {
  // A loop rather than Math.min(...vs): a spread of a very large group overflows the stack.
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  let n = 0;
  for (const v of vs) {
    if (v == null) continue;
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v;
    n++;
  }
  return n === 0 ? null : { mean: round3(sum / n), min, max };
}

/** What a group would be saved as. */
export interface GroupSummary {
  priType: ReportPriType;
  count: number;
  rf: Measured;
  pri: Measured | null;
  pw: Measured | null;
  jitter: Measured | null;
  /** Mean of each stagger position. */
  stagger: number[] | null;
  tracks: string[];
  /** "U000A / default" per distinct identification, with how many reports. */
  identifiedAs: { label: string; count: number }[];
  firstTime: string | null;
  lastTime: string | null;
}

export function summarize(groupReports: CsvReport[]): GroupSummary {
  const first = groupReports[0];
  const ids = new Map<string, number>();
  for (const r of groupReports) {
    const label = r.designation ? `${r.designation}${r.modeName ? ` / ${r.modeName}` : ""}` : "not identified";
    ids.set(label, (ids.get(label) ?? 0) + 1);
  }
  const times = groupReports.map((r) => r.missionTime).filter((t): t is string => !!t).sort();
  const positions = first.staggerUs?.length ?? 0;
  return {
    priType: first.priType,
    count: groupReports.length,
    rf: measure(groupReports.map((r) => r.rfMhz))!,
    pri: measure(groupReports.map((r) => r.priUs)),
    pw: measure(groupReports.map((r) => r.pwUs)),
    jitter: first.priType === "fixed" ? measure(groupReports.map((r) => r.jitterUs)) : null,
    stagger:
      first.priType === "stagger"
        ? Array.from({ length: positions }, (_, i) => mean(groupReports.map((r) => r.staggerUs?.[i] ?? 0)))
        : null,
    tracks: [...new Set(groupReports.map((r) => r.track).filter((t): t is string => !!t))],
    identifiedAs: [...ids].map(([label, count]) => ({ label, count })),
    firstTime: times[0] ?? null,
    lastTime: times[times.length - 1] ?? null,
  };
}

function listLines(lines: number[]): string {
  return lines.length <= 8 ? lines.join(", ") : `${lines.slice(0, 8).join(", ")} and ${lines.length - 8} more`;
}

/** The entry a group is saved as: the mean of its reports, with their min and
 * max as the measured range when there's more than one report. */
export function toEntryInput(s: GroupSummary, lines: number[], fileName: string): InterceptEntryInput {
  const range = (m: Measured | null) => (s.count > 1 && m ? { min: m.min, max: m.max } : { min: null, max: null });
  const rf = range(s.rf);
  const pri = range(s.pri);
  const pw = range(s.pw);
  const note = [
    `${s.count} report${s.count === 1 ? "" : "s"} from ${fileName} (line${lines.length === 1 ? "" : "s"} ${listLines(lines)})`,
    s.tracks.length > 0 && `track${s.tracks.length === 1 ? "" : "s"} ${s.tracks.join(", ")}`,
    s.identifiedAs.length > 0 && `identified as ${s.identifiedAs.map((i) => i.label).join(", ")}`,
    s.priType === "fixed" && s.jitter == null && "no jitter in the file, saved as 0",
  ]
    .filter(Boolean)
    .join("; ");
  return {
    pri_type: s.priType,
    rf_mean_mhz: s.rf.mean,
    rf_min_mhz: rf.min,
    rf_max_mhz: rf.max,
    pri_mean_us: s.priType === "cw" ? null : (s.pri?.mean ?? null),
    pri_min_us: s.priType === "cw" ? null : pri.min,
    pri_max_us: s.priType === "cw" ? null : pri.max,
    pw_mean_us: s.priType === "cw" ? null : (s.pw?.mean ?? null),
    pw_min_us: s.priType === "cw" ? null : pw.min,
    pw_max_us: s.priType === "cw" ? null : pw.max,
    jitter_mean_us: s.priType === "fixed" ? (s.jitter?.mean ?? 0) : null,
    stagger_values: s.stagger,
    notes: note,
  };
}
