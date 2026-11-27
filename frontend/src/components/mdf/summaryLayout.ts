/** How the release notes are laid out — the change log's detail and
 * grouping, the parts that go in, and the Platforms and Emitters tables'
 * columns and rows — remembered in this browser, shared by the Summary panel
 * and the release-notes preview page. */
import type { ChangeLogDetail, ChangeLogGroup, SummaryPart, SummaryTables } from "../../api/mdfPlan";

export interface Layout {
  detail: ChangeLogDetail;
  group: ChangeLogGroup;
  parts: SummaryPart[];
  tables: SummaryTables;
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
export const DEFAULT_LAYOUT: Layout = { detail: "full", group: "change", parts: STARTING_PARTS, tables: DEFAULT_TABLES };

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
