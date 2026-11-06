import type { ChangeNote } from "../../api/mdfPlan";

/** The change-notes preview on Admin › Defaults: an MDF's notes as draft
 * rules write them, beside the saved rules' notes. */

export type Mark = "same" | "shown" | "hidden";
export interface MarkedNote {
  kind: ChangeNote["kind"];
  name: string;
  detail?: string | null;
  mark: Mark;
  items: { text: string; mark: Mark }[];
}

/** The notes as the draft rules write them, beside the saved rules': lines
 * only the draft has are marked "shown", lines only the saved rules have
 * "hidden". */
export function merge(draft: ChangeNote[], saved: ChangeNote[]): MarkedNote[] {
  const key = (n: ChangeNote) => `${n.kind}\u0000${n.name}`;
  const savedBy = new Map(saved.map((n) => [key(n), n]));
  const draftKeys = new Set(draft.map(key));
  const out: MarkedNote[] = draft.map((n) => {
    const before = savedBy.get(key(n));
    if (!before) return { ...n, mark: "shown", items: (n.items ?? []).map((text) => ({ text, mark: "shown" })) };
    const had = new Set(before.items ?? []);
    const has = new Set(n.items ?? []);
    return {
      ...n,
      mark: "same",
      items: [
        ...(n.items ?? []).map((text) => ({ text, mark: (had.has(text) ? "same" : "shown") as Mark })),
        ...(before.items ?? []).filter((t) => !has.has(t)).map((text) => ({ text, mark: "hidden" as Mark })),
      ],
    };
  });
  for (const n of saved) {
    if (!draftKeys.has(key(n))) out.push({ ...n, mark: "hidden", items: (n.items ?? []).map((text) => ({ text, mark: "hidden" })) });
  }
  return out;
}

/** How many lines the draft rules add ("shown") and take away ("hidden"). */
export function countMarks(sections: MarkedNote[][]) {
  let shown = 0;
  let hidden = 0;
  for (const n of sections.flat()) {
    const lines = [n.mark, ...n.items.filter(() => n.mark === "same").map((i) => i.mark)];
    shown += lines.filter((m) => m === "shown").length;
    hidden += lines.filter((m) => m === "hidden").length;
  }
  return { shown, hidden };
}

