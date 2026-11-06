import { describe, expect, it } from "vitest";
import { matchesWords, searchWords } from "../../utils/wordSearch";
import { frameTimeFromText, frameTimeUs } from "./frameTime";
import { compareNullable, naturalCompare } from "./sortUtils";

describe("search words", () => {
  it("splits at spaces and name separators and matches in any order", () => {
    expect(searchWords("Scan_6 fixed")).toEqual(["scan", "6", "fixed"]);
    expect(matchesWords("scan_fixed_6", searchWords("6 scan"))).toBe(true);
    expect(matchesWords("scan_fixed_6", searchWords("track"))).toBe(false);
    expect(matchesWords("anything", [])).toBe(true);
  });
});

describe("frame time", () => {
  it("sums one cycle without binary rounding noise", () => {
    expect(frameTimeUs([100.1, 200.2])).toBe(300.3);
    expect(frameTimeFromText("700, 750, ")).toBe(1450);
  });
});

describe("sorting", () => {
  it("puts nulls last both ways and sorts names naturally", () => {
    expect([3, null, 1].sort((a, b) => compareNullable(a, b, "desc"))).toEqual([3, 1, null]);
    expect(["Mode 10", "Mode 2"].sort((a, b) => naturalCompare(a, b, "asc"))).toEqual(["Mode 2", "Mode 10"]);
  });
});
