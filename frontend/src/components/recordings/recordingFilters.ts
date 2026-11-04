import type { PriType } from "../../types/domain";
import type { CsvReport } from "../intercepts/interceptCsv";
import { toMissionTime } from "../intercepts/interceptGroups";

/** What a snip of a recording holds: a time window, parameter ranges and a
 * few other cuts. Stored on an Intercept made from it (as `snip`), and put in
 * the import page's address so a snip can be reopened. */
export interface RecordingFilters {
  /** ISO times, UTC. */
  t0?: string;
  t1?: string;
  rf_min?: number;
  rf_max?: number;
  pri_min?: number;
  pri_max?: number;
  pw_min?: number;
  pw_max?: number;
  types?: PriType[];
  tracks?: string[];
  /** Text in what the system identified it as. */
  identified?: string;
}

export type FilterParam = "rf" | "pri" | "pw";

export const PARAM_LABEL: Record<FilterParam, string> = { rf: "RF", pri: "PRI", pw: "PW" };
export const PARAM_UNIT: Record<FilterParam, string> = { rf: "MHz", pri: "µs", pw: "µs" };

const NUMBER_KEYS = ["rf_min", "rf_max", "pri_min", "pri_max", "pw_min", "pw_max"] as const;

/** Only the cuts actually set — what's stored and sent. */
export function cleanFilters(f: RecordingFilters): RecordingFilters {
  const out: RecordingFilters = {};
  if (f.t0) out.t0 = f.t0;
  if (f.t1) out.t1 = f.t1;
  for (const k of NUMBER_KEYS) {
    const v = f[k];
    if (v != null && Number.isFinite(v)) out[k] = v;
  }
  if (f.types && f.types.length > 0) out.types = [...f.types];
  if (f.tracks && f.tracks.length > 0) out.tracks = [...f.tracks];
  if (f.identified?.trim()) out.identified = f.identified.trim();
  return out;
}

export function filtersToQuery(f: RecordingFilters): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(cleanFilters(f))) {
    q.set(k, Array.isArray(v) ? v.join(",") : String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : "";
}

/** A stored snip read back, whatever it holds — unknown keys and bad values dropped. */
export function readFilters(raw: unknown): RecordingFilters {
  if (!raw || typeof raw !== "object") return {};
  const r = raw as Record<string, unknown>;
  const out: RecordingFilters = {};
  if (typeof r.t0 === "string") out.t0 = r.t0;
  if (typeof r.t1 === "string") out.t1 = r.t1;
  for (const k of NUMBER_KEYS) {
    const v = typeof r[k] === "string" ? Number(r[k]) : r[k];
    if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
  }
  if (Array.isArray(r.types)) out.types = r.types.filter((t): t is PriType => t === "fixed" || t === "stagger" || t === "cw");
  if (Array.isArray(r.tracks)) out.tracks = r.tracks.map(String);
  if (typeof r.identified === "string") out.identified = r.identified;
  return cleanFilters(out);
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** "01.12.2025 08:03:00" — times as in the file, UTC. */
export function formatUtc(iso: string | number, withDate = true): string {
  const d = new Date(iso);
  const time = `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`;
  if (!withDate) return time;
  return `${pad2(d.getUTCDate())}.${pad2(d.getUTCMonth() + 1)}.${d.getUTCFullYear()} ${time}`;
}

function range(lo: number | undefined, hi: number | undefined, unit: string) {
  if (lo != null && hi != null) return `${lo}–${hi} ${unit}`;
  if (lo != null) return `≥ ${lo} ${unit}`;
  return `≤ ${hi} ${unit}`;
}

/** A snip in words: "08:03:00–08:06:30 · RF 3000–3005 MHz · fixed". */
export function describeSnip(raw: unknown): string {
  const f = readFilters(raw);
  const parts: string[] = [];
  if (f.t0 || f.t1) {
    const sameDay = f.t0 && f.t1 && f.t0.slice(0, 10) === f.t1.slice(0, 10);
    const a = f.t0 ? formatUtc(f.t0) : "start";
    const b = f.t1 ? formatUtc(f.t1, !sameDay) : "end";
    parts.push(`${a} – ${b}`);
  }
  for (const p of ["rf", "pri", "pw"] as FilterParam[]) {
    const lo = f[`${p}_min`];
    const hi = f[`${p}_max`];
    if (lo != null || hi != null) parts.push(`${PARAM_LABEL[p]} ${range(lo, hi, PARAM_UNIT[p])}`);
  }
  if (f.types) parts.push(f.types.join(", "));
  if (f.tracks) parts.push(`track${f.tracks.length > 1 ? "s" : ""} ${f.tracks.join(", ")}`);
  if (f.identified) parts.push(`identified “${f.identified}”`);
  return parts.length ? parts.join(" · ") : "the whole recording";
}

/** Rounds a value picked off a chart to what's worth writing down. */
export function niceValue(v: number, span: number): number {
  const step = span > 0 ? Math.pow(10, Math.floor(Math.log10(span)) - 2) : 0.001;
  const digits = Math.max(0, -Math.floor(Math.log10(step)));
  return Number((Math.round(v / step) * step).toFixed(Math.min(digits, 6)));
}

/** A snip's reports (fields named once, a row each) as the import page reads
 * a file: numbered in order, each remembering its line in the recording. */
export function snipToReports(snip: { recording: string; fields: string[]; reports: unknown[][] }): CsvReport[] {
  const f = Object.fromEntries(snip.fields.map((name, i) => [name, i])) as Record<string, number>;
  return snip.reports.map((row, i) => ({
    line: i + 1,
    fileLine: row[f.file_line] as number,
    sourceFile: snip.recording,
    missionTime: toMissionTime(row[f.mission_time] as string | null),
    track: row[f.track] as string | null,
    modeTrack: row[f.mode_track] as string | null,
    power: row[f.power] as number | null,
    designation: row[f.designation] as string | null,
    modeName: row[f.mode_name] as string | null,
    ambiguityCount: row[f.ambiguity_count] as number | null,
    priType: row[f.pri_type] as CsvReport["priType"],
    rfMhz: row[f.rf_mhz] as number,
    priUs: row[f.pri_us] as number | null,
    pwUs: row[f.pw_us] as number | null,
    jitterUs: row[f.jitter_us] as number | null,
    staggerUs: row[f.stagger_us] as number[] | null,
  }));
}
