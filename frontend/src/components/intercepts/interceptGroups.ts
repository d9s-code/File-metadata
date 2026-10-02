/** Grouping imported reports into Intercept entries. Every change here is
 * one the user asked for — nothing is grouped until they merge reports or
 * press Auto group, and Auto group follows the one rule described in
 * AUTO_GROUP_RULE, with the gaps and minimum they set. */
import type { CsvReport, ReportPriType } from "./interceptCsv";
import type { InterceptEntryInput } from "../../api/intercepts";

export interface ReportGroup {
  /** Stable for React keys; the lowest line number in the group. */
  id: number;
  /** Line numbers of its reports, in file order. */
  lines: number[];
  excluded: boolean;
  /** Set aside by Auto group as a stray: held out of the import, like an
   * excluded row, until the user merges it, keeps it or excludes it. */
  stray?: boolean;
}

/** Auto group's settings. */
export interface GapSettings {
  /** A gap wider than this, with no reports in it, starts a new group. */
  rfMhz: number;
  /** PRI, or for a stagger its frame time and each position. */
  priUs: number;
  pwUs: number;
  /** Groups need at least this many reports; see AUTO_GROUP_RULE. */
  minReports: number;
  sameTrack: boolean;
}

export const AUTO_GROUP_RULE =
  "First it separates the reports by PRI type (and, for a stagger, the number of positions) — and by track " +
  "number when \"same track number\" is ticked. Then it lines the reports up by RF and starts a new group " +
  "wherever there is an empty stretch wider than the RF gap, then does the same on PRI (a stagger's frame time " +
  "and each position) and on PW, and repeats until nothing splits further. So reports that run on into each " +
  "other stay together however wide the group gets, and two signals end up apart as soon as there's a clear " +
  "gap between them on any one parameter. Then the minimum: a report is a stray when its group has fewer " +
  "reports than the minimum, or when fewer than (minimum − 1) others in its group are within the gaps of it on " +
  "RF, PRI and PW at once. Strays are set aside — which can open new gaps, so it splits again — and listed as " +
  "Strays, held out of the import until you merge, keep or exclude them. A minimum of 1 means no strays. Time, " +
  "power, jitter and the system's identification aren't used. Excluded rows are left as they are. It " +
  "replaces the current grouping; you can merge, split and exclude afterwards.";

/** One group per report — where an import starts. */
export function oneGroupPerReport(reports: CsvReport[], excluded = new Set<number>()): ReportGroup[] {
  return reports.map((r) => ({ id: r.line, lines: [r.line], excluded: excluded.has(r.line) }));
}

function makeGroup(lines: number[], excluded: boolean, stray = false): ReportGroup {
  const sorted = [...lines].sort((a, b) => a - b);
  return stray ? { id: sorted[0], lines: sorted, excluded, stray } : { id: sorted[0], lines: sorted, excluded };
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

/** The selected groups become one. It's left out of the import only when
 * every one of them was excluded by the user — merging strays is a decision
 * to keep them. */
export function mergeGroups(groups: ReportGroup[], ids: Set<number>): ReportGroup[] {
  const picked = groups.filter((g) => ids.has(g.id));
  const merged = makeGroup(
    picked.flatMap((g) => g.lines),
    picked.every((g) => g.excluded && !g.stray),
  );
  return [...groups.filter((g) => !ids.has(g.id)), merged];
}

/** The selected groups go back to one group per report. */
export function splitGroups(groups: ReportGroup[], ids: Set<number>): ReportGroup[] {
  return groups.flatMap((g) => (ids.has(g.id) ? g.lines.map((l) => makeGroup([l], g.excluded, g.stray)) : [g]));
}

/** One report leaves its group and becomes its own. */
export function takeOut(groups: ReportGroup[], groupId: number, line: number): ReportGroup[] {
  return groups.flatMap((g) => {
    if (g.id !== groupId || g.lines.length < 2) return [g];
    return [makeGroup(g.lines.filter((l) => l !== line), g.excluded), makeGroup([line], g.excluded)];
  });
}

/** Exclude or include rows. Either way they stop being strays — the user has decided. */
export function setExcluded(groups: ReportGroup[], ids: Set<number>, excluded: boolean): ReportGroup[] {
  return groups.map((g) => (ids.has(g.id) ? { id: g.id, lines: g.lines, excluded } : g));
}

export type SplitParam = "rf" | "pri" | "pw";

/** A report's value on a parameter — PRI is a stagger's frame time, none for CW. */
export function paramValue(r: CsvReport, p: SplitParam): number | null {
  return p === "rf" ? r.rfMhz : p === "pri" ? r.priUs : r.pwUs;
}

/** Each selected group with reports on both sides of the value becomes two:
 * those at or below it, and those above. Reports without the parameter (CW
 * has no PRI or PW) stay with the lower part. */
export function splitAtValue(
  groups: ReportGroup[],
  ids: Set<number>,
  byLine: Map<number, CsvReport>,
  param: SplitParam,
  value: number,
): { groups: ReportGroup[]; split: number } {
  let split = 0;
  const next = groups.flatMap((g) => {
    if (!ids.has(g.id)) return [g];
    const above = g.lines.filter((l) => (paramValue(byLine.get(l)!, param) ?? -Infinity) > value);
    if (above.length === 0 || above.length === g.lines.length) return [g];
    split++;
    const aboveSet = new Set(above);
    return [
      makeGroup(g.lines.filter((l) => !aboveSet.has(l)), g.excluded, g.stray),
      makeGroup(above, g.excluded, g.stray),
    ];
  });
  return { groups: next, split };
}

type Getter = (r: CsvReport) => number | null;

/** The parameters a group is split on, with their gaps: RF, PRI (frame
 * time), PW, and for a stagger each position (with the PRI gap). */
function splitParams(positions: number, gap: GapSettings): [Getter, number][] {
  const out: [Getter, number][] = [
    [(r) => r.rfMhz, gap.rfMhz],
    [(r) => r.priUs, gap.priUs],
    [(r) => r.pwUs, gap.pwUs],
  ];
  for (let i = 0; i < positions; i++) out.push([(r) => r.staggerUs?.[i] ?? null, gap.priUs]);
  return out;
}

/** Splits wherever neighbouring values, sorted, are more than the gap apart.
 * Reports without the value (CW has no PRI) aren't split on it. */
function splitOnGaps(rs: CsvReport[], get: Getter, gap: number): CsvReport[][] {
  if (rs.length < 2 || rs.some((r) => get(r) == null)) return [rs];
  const sorted = [...rs].sort((a, b) => get(a)! - get(b)!);
  const out: CsvReport[][] = [[sorted[0]]];
  for (let i = 1; i < sorted.length; i++) {
    if (get(sorted[i])! - get(sorted[i - 1])! > gap + 1e-9) out.push([]);
    out[out.length - 1].push(sorted[i]);
  }
  return out;
}

/** Splits on every parameter in turn until nothing splits further. */
function splitFully(part: CsvReport[], params: [Getter, number][]): CsvReport[][] {
  let parts = [part];
  for (;;) {
    let next = parts;
    for (const [get, gap] of params) next = next.flatMap((p) => splitOnGaps(p, get, gap));
    if (next.length === parts.length) return parts;
    parts = next;
  }
}

/** The reports in a part with fewer than `need` others within the gaps of
 * them on every parameter at once. Walks out from each report in RF order,
 * stopping as soon as it has found enough, so large dense groups stay quick. */
function sparseIn(part: CsvReport[], params: [Getter, number][], need: number): Set<CsvReport> {
  const sparse = new Set<CsvReport>();
  if (need <= 0) return sparse;
  if (part.length <= need) return new Set(part);
  const [rfGet, rfGap] = params[0];
  const rest = params.slice(1);
  const sorted = [...part].sort((a, b) => rfGet(a)! - rfGet(b)!);
  const near = (a: CsvReport, b: CsvReport) =>
    rest.every(([get, gap]) => {
      const va = get(a);
      const vb = get(b);
      return va == null || vb == null || Math.abs(va - vb) <= gap + 1e-9;
    });
  for (let i = 0; i < sorted.length; i++) {
    const r = sorted[i];
    const rf = rfGet(r)!;
    let found = 0;
    for (let j = i - 1; j >= 0 && found < need && rf - rfGet(sorted[j])! <= rfGap + 1e-9; j--)
      if (near(r, sorted[j])) found++;
    for (let j = i + 1; j < sorted.length && found < need && rfGet(sorted[j])! - rf <= rfGap + 1e-9; j++)
      if (near(r, sorted[j])) found++;
    if (found < need) sparse.add(r);
  }
  return sparse;
}

export interface AutoGroupResult {
  groups: ReportGroup[];
  /** Strays, each its own group, held out of the import. */
  strays: ReportGroup[];
}

/** See AUTO_GROUP_RULE. Works on the reports given; the caller keeps the rest. */
export function autoGroup(reports: CsvReport[], gap: GapSettings): AutoGroupResult {
  const kinds = new Map<string, CsvReport[]>();
  for (const r of reports) {
    const key = `${r.priType}/${r.staggerUs?.length ?? 0}${gap.sameTrack ? `/${r.track ?? ""}` : ""}`;
    const list = kinds.get(key);
    if (list) list.push(r);
    else kinds.set(key, [r]);
  }
  const need = Math.max(0, Math.floor(gap.minReports) - 1);
  const groups: ReportGroup[] = [];
  const strays: ReportGroup[] = [];
  for (const kind of kinds.values()) {
    const params = splitParams(kind[0].staggerUs?.length ?? 0, gap);
    // Split, set the strays aside, and split what's left again — taking out a
    // trickle of strays can open the gap between two signals it was bridging.
    let pending = [kind];
    while (pending.length > 0) {
      const next: CsvReport[][] = [];
      for (const part of pending.flatMap((p) => splitFully(p, params))) {
        const sparse = sparseIn(part, params, need);
        for (const r of sparse) strays.push(makeGroup([r.line], true, true));
        if (sparse.size === 0) groups.push(makeGroup(part.map((r) => r.line), false));
        else if (sparse.size < part.length) next.push(part.filter((r) => !sparse.has(r)));
      }
      pending = next;
    }
  }
  return { groups, strays };
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
