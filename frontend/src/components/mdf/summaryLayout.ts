/** How the release notes are laid out — the change log's detail and
 * grouping, the parts that go in, and the Platforms and Emitters tables'
 * columns and rows — remembered in this browser, shared by the Summary panel
 * and the release-notes preview page. */
import type { ChangeLogDetail, ChangeLogGroup, DocKind, ProgressPart, SummaryPart, SummaryTables } from "../../api/mdfPlan";

export type DocFormat = "document" | "slides";

export interface Layout {
  detail: ChangeLogDetail;
  group: ChangeLogGroup;
  /** The release notes' parts. */
  parts: SummaryPart[];
  tables: SummaryTables;
  /** The MDF's version numbers in the document, or dates only. */
  showVersion: boolean;
  /** What the preview page shows: the release notes or a progress note, as a document or as slides. */
  kind: DocKind;
  format: DocFormat;
  progressParts: ProgressPart[];
}

const KEY = "mdf-summary-layout";
export const ALL_PARTS: SummaryPart[] = ["meta", "release_notes", "platforms", "emitters", "contents"];
/** In unless taken out: the parts before the tables existed. */
const STARTING_PARTS: SummaryPart[] = ["meta", "release_notes", "contents"];
export const DEFAULT_TABLES: SummaryTables = {
  platform_columns: ["platform", "version", "status", "emitters"],
  emitter_columns: ["designation", "emitter", "version", "status", "modes", "rf", "pri", "pw"],
  rows: "all",
};
export const ALL_PROGRESS_PARTS: ProgressPart[] = ["meta", "goals", "progress_log", "emitter_progress", "changes", "platforms", "emitters"];
const STARTING_PROGRESS: ProgressPart[] = ["meta", "goals", "progress_log", "emitter_progress", "changes"];
export const DEFAULT_LAYOUT: Layout = {
  detail: "full",
  group: "change",
  parts: STARTING_PARTS,
  tables: DEFAULT_TABLES,
  showVersion: true,
  kind: "release",
  format: "document",
  progressParts: STARTING_PROGRESS,
};

export const DETAILS: [ChangeLogDetail, string][] = [
  ["full", "Full detail"],
  ["names", "Names only"],
  ["counts", "Counts only"],
  ["sentences", "Plain sentences"],
];
export const PART_LABELS: [SummaryPart, string][] = [
  ["meta", "Versions & details"],
  ["release_notes", "Release notes"],
  ["platforms", "Platforms table"],
  ["emitters", "Emitters table"],
  ["contents", "Contents table"],
];
export const PROGRESS_PART_LABELS: [ProgressPart, string][] = [
  ["meta", "Status & details"],
  ["goals", "Goals"],
  ["progress_log", "Progress log (since the last release)"],
  ["emitter_progress", "Emitter progress per Platform"],
  ["changes", "Changes so far"],
  ["platforms", "Platforms table"],
  ["emitters", "Emitters table"],
];

const strings = (v: unknown): string[] | null => (Array.isArray(v) && v.every((x) => typeof x === "string") ? v : null);

export function readLayout(): Layout {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<Layout> | null;
    if (!v) return DEFAULT_LAYOUT;
    const t = (v.tables ?? {}) as Partial<SummaryTables>;
    return {
      detail: (["full", "names", "counts", "sentences"] as const).includes(v.detail as ChangeLogDetail) ? (v.detail as ChangeLogDetail) : "full",
      group: v.group === "platform" ? "platform" : "change",
      parts: Array.isArray(v.parts) ? ALL_PARTS.filter((p) => v.parts!.includes(p)) : STARTING_PARTS,
      tables: {
        platform_columns: strings(t.platform_columns) ?? DEFAULT_TABLES.platform_columns,
        emitter_columns: strings(t.emitter_columns) ?? DEFAULT_TABLES.emitter_columns,
        rows: t.rows === "changed" ? "changed" : "all",
      },
      showVersion: v.showVersion !== false,
      kind: v.kind === "progress" ? "progress" : "release",
      format: v.format === "slides" ? "slides" : "document",
      progressParts: Array.isArray(v.progressParts) ? ALL_PROGRESS_PARTS.filter((p) => v.progressParts!.includes(p)) : STARTING_PROGRESS,
    };
  } catch {
    return DEFAULT_LAYOUT;
  }
}

export function saveLayout(l: Layout) {
  try {
    localStorage.setItem(KEY, JSON.stringify(l));
  } catch {
    // Not kept; fine.
  }
}

/** Saves a blob as a file. */
export function saveFile(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
