/** Reads an EmitterTrackParameters CSV export into reports — one per row —
 * ready to be grouped into Intercept entries. Times in the file are ns and
 * come out in µs; RF stays in MHz. Nothing is grouped or averaged here. */

export type ReportPriType = "fixed" | "stagger" | "cw";

export interface CsvReport {
  /** Line number in the file (the header is line 1). */
  line: number;
  /** As written, e.g. "20251201-111008.902000". */
  missionTime: string | null;
  track: string | null;
  modeTrack: string | null;
  /** dBm. */
  power: number | null;
  /** What the system identified the signal as — the first (best) candidate. */
  elnot: string | null;
  modeName: string | null;
  /** How many candidates the system had. */
  ambiguityCount: number | null;
  priType: ReportPriType;
  rfMhz: number;
  /** PRI, or a stagger's frame time. Null for CW. */
  priUs: number | null;
  pwUs: number | null;
  /** Fixed only. */
  jitterUs: number | null;
  /** Stagger only, in order. */
  staggerUs: number[] | null;
}

export interface SkippedRow {
  line: number;
  reason: string;
}

export interface ParsedCsv {
  reports: CsvReport[];
  skipped: SkippedRow[];
}

const COL = {
  missionTime: "MissionTime",
  track: "TrackNumber",
  modeTrack: "ModeTrackNumber",
  ambiguityCount: "ModeAmbiguityCount",
  elnot: "ModeIdAmbiguities_0_ELNOT",
  modeName: "ModeIdAmbiguities_0_ModeName",
  power: "ReceivedPower",
  rf: "Parameters_RF",
  priClass: "Parameters_PRIClass",
  basePri: "Parameters_BasePRI",
  pw: "Parameters_PulseWidth",
  jitter: "Parameters_Parameters_Simple_Jitter",
  staggerCount: "Parameters_Parameters_Stagger_Count",
} as const;
const STAGGER_POSITION = (i: number) => `Parameters_Parameters_Stagger_Position${i}`;
const REQUIRED = [COL.rf, COL.priClass, COL.basePri, COL.pw];

/** Splits CSV text into rows of cells, honouring double-quoted cells. */
function splitCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/** Blank cells and the exporter's "<EMPTY>" both mean no value. */
function clean(v: string | undefined): string | null {
  const t = (v ?? "").trim();
  return t === "" || t.toUpperCase() === "<EMPTY>" ? null : t;
}

function number(v: string | null): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** ns -> µs, kept to the ns the file was written in. */
const nsToUs = (ns: number) => Math.round(ns) / 1000;

export class CsvFormatError extends Error {}

export function parseInterceptCsv(text: string): ParsedCsv {
  const rows = splitCsv(text.replace(/^﻿/, ""));
  const header = (rows[0] ?? []).map((h) => h.trim());
  const missing = REQUIRED.filter((c) => !header.includes(c));
  if (missing.length > 0) {
    throw new CsvFormatError(
      `This doesn't look like an EmitterTrackParameters export — missing column${missing.length === 1 ? "" : "s"} ${missing.join(", ")}.`,
    );
  }
  const index = new Map(header.map((h, i) => [h, i]));

  const reports: CsvReport[] = [];
  const skipped: SkippedRow[] = [];
  rows.slice(1).forEach((cells, i) => {
    const line = i + 2;
    if (cells.every((c) => clean(c) == null)) return; // blank line
    const get = (column: string) => {
      const at = index.get(column);
      return at == null ? null : clean(cells[at]);
    };
    const priClass = (get(COL.priClass) ?? "").toLowerCase();
    const rf = number(get(COL.rf));
    if (rf == null) {
      skipped.push({ line, reason: "No RF value" });
      return;
    }
    const common = {
      line,
      missionTime: get(COL.missionTime),
      track: get(COL.track),
      modeTrack: get(COL.modeTrack),
      power: number(get(COL.power)),
      elnot: get(COL.elnot),
      modeName: get(COL.modeName),
      ambiguityCount: number(get(COL.ambiguityCount)),
      rfMhz: rf,
    };
    const basePri = number(get(COL.basePri));
    const pw = number(get(COL.pw));

    if (priClass === "cw") {
      reports.push({ ...common, priType: "cw", priUs: null, pwUs: null, jitterUs: null, staggerUs: null });
    } else if (priClass === "simple") {
      if (basePri == null || basePri <= 0 || pw == null || pw <= 0) {
        skipped.push({ line, reason: "Fixed PRI without a PRI or pulse width" });
        return;
      }
      const jitter = number(get(COL.jitter));
      reports.push({
        ...common,
        priType: "fixed",
        priUs: nsToUs(basePri),
        pwUs: nsToUs(pw),
        jitterUs: jitter == null ? null : nsToUs(jitter),
        staggerUs: null,
      });
    } else if (priClass === "stagger") {
      const count = number(get(COL.staggerCount)) ?? 0;
      const positions: number[] = [];
      for (let p = 0; p < count; p++) {
        const v = number(get(STAGGER_POSITION(p)));
        if (v == null || v <= 0) break;
        positions.push(nsToUs(v));
      }
      if (positions.length === 0 || positions.length !== count) {
        skipped.push({ line, reason: `Stagger with ${count} position${count === 1 ? "" : "s"} but values missing` });
        return;
      }
      if (pw == null || pw <= 0) {
        skipped.push({ line, reason: "Stagger without a pulse width" });
        return;
      }
      // BasePRI is the frame time (the sum of the positions); fall back to the sum.
      const frame = basePri != null && basePri > 0 ? nsToUs(basePri) : Math.round(positions.reduce((a, b) => a + b, 0) * 1000) / 1000;
      reports.push({ ...common, priType: "stagger", priUs: frame, pwUs: nsToUs(pw), jitterUs: null, staggerUs: positions });
    } else if (priClass === "xlet") {
      skipped.push({ line, reason: "X-let isn't supported yet" });
    } else {
      skipped.push({ line, reason: priClass ? `Unknown PRI class "${get(COL.priClass)}"` : "No PRI class" });
    }
  });
  return { reports, skipped };
}

/** "20251201-111008.902000" -> "2025-12-01 11:10:08.902". */
export function formatMissionTime(t: string | null): string {
  const m = t?.match(/^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})(\.\d{1,3})?/);
  if (!m) return t ?? "—";
  return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6]}${m[7] ?? ""}`;
}

/** The day of a mission time, as YYYY-MM-DD. */
export function missionDay(t: string | null): string | null {
  const m = t?.match(/^(\d{4})(\d{2})(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}
