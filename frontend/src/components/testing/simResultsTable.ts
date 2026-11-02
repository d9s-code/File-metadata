import type { ObservedValues } from "../../api/testRecords";
import type { ModeNameOption } from "./ModeMultiSelect";
import { DEFAULT_UNKNOWN } from "./ModeMultiSelect";

/** A SIM run's results pasted from a table, one row per intercept, columns
 * by position (no header row):
 * SIM line · Intercepted as · Received power (not used) · Mean RF (MHz) ·
 * PRI type · Mean PRI / frame time (µs) · PRI min, PRI max (not used) ·
 * Jitter (%) · Stagger sequence / jitter (ns or µs) · Mean PW (µs) · Stats · Comment. */
export const RESULT_COLUMNS = [
  "SIM line",
  "Intercepted as",
  "Received power (not used)",
  "Mean RF (MHz)",
  "PRI type",
  "Mean PRI / frame time (µs)",
  "PRI min (not used)",
  "PRI max (not used)",
  "Jitter (%)",
  "Stagger sequence / jitter",
  "Mean PW (µs)",
  "Stats",
  "Comment",
] as const;

export type SequenceUnit = "ns" | "us";

export interface ParsedResultRow {
  /** 1-based row number in the pasted text. */
  row: number;
  label: string;
  /** The SIM line it matched, if any. */
  lineId: string | null;
  interceptedModeIds: string[];
  values: ObservedValues;
  notes: string;
  /** What couldn't be used as given. */
  warnings: string[];
}

const EMPTY = new Set(["", "-", "—", "–", "n/a", "na", "none"]);
const UNKNOWN = new Set(["unknown", "default unknown", "def unknown", "du", "unk"]);

const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

/** A number from a cell: decimal comma or point, spaces as thousands
 * separators, a trailing unit ignored. Blank, "-" or "n/a" give undefined. */
export function cellNumber(cell: string | undefined): number | undefined {
  if (cell == null) return undefined;
  let t = cell.trim().replace(/[   ]/g, "");
  if (EMPTY.has(t.toLowerCase())) return undefined;
  if (t.includes(",") && t.includes(".")) t = t.replace(/,/g, "");
  else t = t.replace(",", ".");
  const m = /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?/i.exec(t);
  return m ? Number(m[0]) : undefined;
}

/** A stagger sequence: values split on "/", ";", spaces or line breaks
 * (commas too when nothing else separates them). */
export function cellSequence(cell: string | undefined): number[] {
  if (!cell || EMPTY.has(cell.trim().toLowerCase())) return [];
  let parts = cell.trim().split(/[/;\s]+/).filter(Boolean);
  if (parts.length === 1 && parts[0].includes(",")) parts = parts[0].split(",");
  return parts.map(cellNumber).filter((v): v is number => v != null);
}

/** "Simple" is a fixed PRI; the rest by name. */
export function cellPriType(cell: string | undefined): ObservedValues["pri_type"] | null | undefined {
  const t = (cell ?? "").toLowerCase().replace(/[^a-z]/g, "");
  if (!t) return undefined;
  if (t === "simple" || t === "fixed") return "fixed";
  if (t === "stagger" || t === "staggered") return "stagger";
  if (t === "cw") return "cw";
  if (t === "xlet") return "xlet";
  return null;
}

const tidy = (v: number) => Number(v.toPrecision(12));

function interceptedAs(cell: string, modes: ModeNameOption[], warnings: string[]): string[] {
  const t = norm(cell);
  if (EMPTY.has(t)) return [];
  const byName = new Map(modes.filter((m) => m.id !== DEFAULT_UNKNOWN.id).map((m) => [norm(m.name), m.id]));
  const one = (name: string): string | null => {
    const n = norm(name);
    if (UNKNOWN.has(n)) return DEFAULT_UNKNOWN.id;
    return byName.get(n) ?? null;
  };
  // The whole cell first: a Mode's name can hold a comma or a slash.
  const whole = one(cell);
  if (whole) return [whole];
  const ids: string[] = [];
  for (const name of cell.split(/\s*(?:[,;/+&]|\band\b)\s*/i).filter((s) => s.trim())) {
    const id = one(name);
    if (id) {
      if (!ids.includes(id)) ids.push(id);
    } else warnings.push(`No Mode named "${name.trim()}" — kept in the notes`);
  }
  return ids;
}

/** The measured values of one row, as a logged set. */
function valuesOf(cols: string[], unit: SequenceUnit, warnings: string[], notes: string[]): ObservedValues {
  const v: ObservedValues = {};
  const rf = cellNumber(cols[3]);
  if (rf != null) v.rf_mean_mhz = rf;
  const pw = cellNumber(cols[10]);
  if (pw != null) v.pw_mean_us = pw;
  const type = cellPriType(cols[4]);
  const mean = cellNumber(cols[5]);
  const pct = cellNumber(cols[8]);
  const toUs = (x: number) => tidy(unit === "ns" ? x / 1000 : x);
  if (type === null) {
    warnings.push(`PRI type "${cols[4].trim()}" isn't Simple, Fixed, Stagger, CW or X-let — its PRI values are kept in the notes`);
    notes.push(`PRI type: ${cols[4].trim()}`);
    if (mean != null) notes.push(`Mean PRI/frame time: ${cols[5].trim()}`);
    if (cols[9]?.trim()) notes.push(`Stagger/jitter: ${cols[9].trim()}`);
    return v;
  }
  if (type === undefined) {
    if (mean != null || cols[9]?.trim()) {
      warnings.push("No PRI type — its PRI values are kept in the notes");
      notes.push(`PRI values without a type: ${[cols[5], cols[9]].map((c) => c?.trim() || "—").join(" · ")}`);
    }
    return v;
  }
  v.pri_type = type;
  if (type === "fixed") {
    if (mean != null) v.pri_mean_us = mean;
    // The absolute jitter wins; the percentage of the mean PRI fills in without it.
    const jitter = cellNumber(cols[9]);
    if (jitter != null) v.jitter_mean_us = toUs(jitter);
    else if (pct != null && mean != null) v.jitter_mean_us = tidy((pct / 100) * mean);
    else if (pct != null) warnings.push("Jitter (%) without a mean PRI — left out");
  } else if (type === "stagger") {
    const steps = cellSequence(cols[9]);
    if (steps.length) v.pri_stagger_values_us = steps.map(toUs);
    if (mean != null && mean > 0) v.frame_time_us = mean;
  }
  return v;
}

/** Splits pasted text into cells: tab-separated (a copy from Excel or
 * Sheets) when any tab is there, else "|". */
function rowsOf(text: string): string[][] {
  const lines = text
    .split("\n")
    .map((l) => l.replace(/\r$/, ""))
    .filter((l) => l.trim().length > 0);
  const delimiter = lines.some((l) => l.includes("\t")) ? "\t" : "|";
  return lines.map((l) => l.split(delimiter).map((c) => c.trim()));
}

export function parseResultsTable(
  text: string,
  lines: { id: string; label: string }[],
  modes: ModeNameOption[],
  unit: SequenceUnit,
): ParsedResultRow[] {
  const byLabel = new Map<string, string>();
  for (const l of lines) if (!byLabel.has(norm(l.label))) byLabel.set(norm(l.label), l.id);
  return rowsOf(text)
    .map((cols, i) => ({ cols, row: i + 1 }))
    .filter(({ cols }) => cols[0])
    .map(({ cols, row }) => {
      const warnings: string[] = [];
      const notes: string[] = [];
      const interceptedModeIds = interceptedAs(cols[1] ?? "", modes, warnings);
      if (warnings.length) notes.push(`Intercepted as: ${cols[1].trim()}`);
      const values = valuesOf(cols, unit, warnings, notes);
      if (cols[11]) notes.push(`Stats: ${cols[11]}`);
      if (cols[12]) notes.unshift(cols[12]);
      return {
        row,
        label: cols[0],
        lineId: byLabel.get(norm(cols[0])) ?? null,
        interceptedModeIds,
        values,
        notes: notes.join("\n"),
        warnings,
      };
    });
}
