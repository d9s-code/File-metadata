import { describe, expect, it } from "vitest";
import { optionsProblem, scanOutsideGroup, scanPayload, type MoreOptionsValues } from "./ModeMoreOptions";

const values = (over: Partial<MoreOptionsValues> = {}): MoreOptionsValues => ({
  quality: "100",
  quantity: "2",
  notes: "",
  derivedFrom: new Set(),
  ...over,
});

describe("a Mode's scan", () => {
  it("leaves only the confirmation to check", () => {
    expect(optionsProblem(values())).toBeNull();
    expect(optionsProblem(values({ quality: "101" }))).toMatch(/quality/);
  });

  it("warns when its revisit reaches outside its EW Group's range", () => {
    expect(scanOutsideGroup([1, 2], { min: 1, max: 10 })).toBe(false);
    expect(scanOutsideGroup([0.5, 2], { min: 1, max: 10 })).toBe(true);
    expect(scanOutsideGroup([1, 12], { min: 1, max: 10 })).toBe(true);
    expect(scanOutsideGroup([1, 12], null)).toBe(false);
    expect(scanOutsideGroup(null, { min: 1, max: 10 })).toBe(false);
  });

  it("goes to the API as its id, or null for its operational mode's", () => {
    expect(scanPayload(values({ scanId: "s1" }))).toEqual({ scan_id: "s1" });
    expect(scanPayload(values())).toEqual({ scan_id: null });
  });
});
