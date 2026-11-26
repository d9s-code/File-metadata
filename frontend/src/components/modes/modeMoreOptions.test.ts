import { describe, expect, it } from "vitest";
import { optionsProblem, scanOutsideGroup, scanPayload, scanProblem, type MoreOptionsValues } from "./ModeMoreOptions";

const values = (over: Partial<MoreOptionsValues> = {}): MoreOptionsValues => ({
  quality: "100",
  quantity: "2",
  notes: "",
  derivedFrom: new Set(),
  ...over,
});

describe("a Mode's scan period box", () => {
  it("is both or neither, min not above max", () => {
    expect(scanProblem("", "")).toBeNull();
    expect(scanProblem("1", "2")).toBeNull();
    expect(scanProblem("1", "")).toMatch(/both/);
    expect(scanProblem("3", "2")).toMatch(/above/);
    expect(scanProblem("-1", "2")).toMatch(/0 or more/);
    expect(optionsProblem(values({ scanMin: "3", scanMax: "2" }))).toMatch(/above/);
    expect(optionsProblem(values({ quality: "101", scanMin: "3", scanMax: "2" }))).toMatch(/quality/);
  });

  it("warns when it reaches outside its EW Group's range", () => {
    expect(scanOutsideGroup("1", "2", { min: 1, max: 10 })).toBe(false);
    expect(scanOutsideGroup("0.5", "2", { min: 1, max: 10 })).toBe(true);
    expect(scanOutsideGroup("1", "12", { min: 1, max: 10 })).toBe(true);
    expect(scanOutsideGroup("1", "12", null)).toBe(false);
  });

  it("goes to the API as numbers, or both null to clear it", () => {
    expect(scanPayload(values({ scanMin: "1.5", scanMax: "2" }))).toEqual({ scan_min_s: 1.5, scan_max_s: 2 });
    expect(scanPayload(values())).toEqual({ scan_min_s: null, scan_max_s: null });
  });
});
