import { describe, expect, it } from "vitest";
import type { DocumentationPage } from "../../api/ambiguity";
import { outlineTree } from "./DocumentationKinds";

const page = (path: string) => ({ path, sections: 1 }) as DocumentationPage;

describe("outlineTree", () => {
  it("adds a row for every level above a page, so each can be opened", () => {
    // "Sensors" (a collection) and "Sensors › Bench" (an empty page) have no text of their own.
    const pages = [page("Guide"), page("Sensors › Bench › Run 1"), page("Sensors › Bench › Run 2"), page("Sensors › Notes"), page("Guide › Setup")];
    const tree = outlineTree(pages);
    expect(tree.map((n) => [n.path, n.depth, n.page ? "page" : "place", n.under])).toEqual([
      ["Guide", 0, "page", 1],
      ["Guide › Setup", 1, "page", 0],
      ["Sensors", 0, "place", 4],
      ["Sensors › Bench", 1, "place", 2],
      ["Sensors › Bench › Run 1", 2, "page", 0],
      ["Sensors › Bench › Run 2", 2, "page", 0],
      ["Sensors › Notes", 1, "page", 0],
    ]);
  });

  it("keeps children right under their parent even when names sort between them", () => {
    const tree = outlineTree([page("A"), page("A B"), page("A › C")]);
    expect(tree.map((n) => n.path)).toEqual(["A", "A › C", "A B"]);
  });
});
