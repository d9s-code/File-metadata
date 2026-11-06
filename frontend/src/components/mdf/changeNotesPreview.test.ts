import { describe, expect, it } from "vitest";
import type { ChangeNote } from "../../api/mdfPlan";
import { countMarks, merge } from "./changeNotesPreview";

const radar = (items: string[]): ChangeNote => ({ kind: "Emitter", name: "Sea Search", items });

describe("change-notes preview", () => {
  it("marks lines only the draft has as shown and lines only the saved rules have as hidden", () => {
    const draft = [radar(["1 Mode added: Track", "Search: Confirmation changed"])];
    const saved = [radar(["1 Mode added: Track"]), { kind: "Platform", name: "Frigate", items: ["Now carries Sea Search"] } as ChangeNote];
    const merged = merge(draft, saved);
    expect(merged.map((n) => [n.name, n.mark, n.items.map((i) => i.mark)])).toEqual([
      ["Sea Search", "same", ["same", "shown"]],
      ["Frigate", "hidden", ["hidden"]],
    ]);
    // A hidden entry counts once, not once per line under it.
    expect(countMarks([merged])).toEqual({ shown: 1, hidden: 1 });
  });

  it("finds nothing to mark when draft and saved agree", () => {
    const notes = [radar(["1 Mode added: Track"])];
    expect(countMarks([merge(notes, notes)])).toEqual({ shown: 0, hidden: 0 });
  });
});
