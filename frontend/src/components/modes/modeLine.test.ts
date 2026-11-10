import { describe, expect, it } from "vitest";
import {
  BLANK_LINE,
  blankLine,
  lineProblems,
  linePayload,
  nameAfter,
  nextFreeName,
  parseStagger,
  rangePreview,
  staggerPreview,
  type LineValues,
} from "./modeLine";

const fixed = (over: Partial<LineValues> = {}): LineValues => ({
  ...BLANK_LINE,
  rfMin: "2900",
  rfMax: "3100",
  priMin: "800",
  priMax: "900",
  pwMin: "0.5",
  pwMax: "1",
  ...over,
});

describe("lineProblems", () => {
  it("passes a complete Fixed line", () => {
    expect(lineProblems(fixed(), null)).toEqual({});
  });

  it("names the box and says what's wrong", () => {
    expect(lineProblems(fixed({ rfMin: "" }), null).rf).toEqual({ message: "Enter RF min", box: "min" });
    expect(lineProblems(fixed({ rfMax: "abc" }), null).rf).toEqual({ message: "RF max isn't a number", box: "max" });
    expect(lineProblems(fixed({ pwMin: "2", pwMax: "1" }), null).pw?.box).toBe("max");
    expect(lineProblems(fixed({ priDelta: "-1" }), null).pri).toEqual({ message: "The PRI ± delta can't be negative", box: "delta" });
    expect(lineProblems(fixed({ jitterMin: "3", jitterMax: "1" }), null).jitter?.box).toBe("max");
  });

  it("checks a stagger's sequence, not the Fixed PRI and jitter", () => {
    const stagger = fixed({ priType: "stagger", priMin: "", jitterMin: "", stagger: "700, 750" });
    expect(lineProblems(stagger, null)).toEqual({});
    expect(lineProblems({ ...stagger, stagger: "700, x" }, null).stagger?.message).toContain("“x”");
    expect(lineProblems({ ...stagger, stagger: "700, 0" }, null).stagger?.message).toContain("above 0");
    expect(lineProblems({ ...stagger, stagger: "" }, null).stagger?.box).toBe("sequence");
    expect(lineProblems(stagger, 0).stagger?.box).toBe("frame");
  });
});

describe("linePayload", () => {
  it("fills a blank max with the min and leaves out what the PRI type doesn't have", () => {
    const p = linePayload(fixed({ rfMax: "" }), null);
    expect([p.rf_min_mhz, p.rf_max_mhz]).toEqual([2900, 2900]);
    expect([p.pri_min_us, p.pri_max_us, p.jitter_min_us, p.jitter_max_us]).toEqual([800, 900, 0, 1]);
    expect(p.pri_stagger_values_us).toBeUndefined();
  });

  it("sends a stagger's steps and frame-time delta", () => {
    const p = linePayload(fixed({ priType: "stagger", stagger: "700 750;800", frameTimeDelta: "3" }), 2300);
    expect(p.pri_stagger_values_us).toEqual([700, 750, 800]);
    expect([p.frame_time_delta_us, p.explicit_frame_time_us]).toEqual([3, 2300]);
    expect([p.pri_min_us, p.jitter_min_us]).toEqual([undefined, undefined]);
  });
});

describe("blankLine", () => {
  it("starts from the admin's default deltas", () => {
    const line = blankLine({ confirmation_quality: 100, confirmation_quantity: 2, frame_time_delta_us: 3, rf_delta: 1, pri_delta: 2, pw_delta: 0.05, stagger_step_delta_us: 1 });
    expect([line.rfDelta, line.priDelta, line.pwDelta, line.frameTimeDelta]).toEqual(["1", "2", "0.05", "3"]);
  });
});

describe("previews", () => {
  it("parses a stagger typed with commas, spaces or semicolons", () => {
    expect(parseStagger("100, 200 300;400")).toEqual({ values: [100, 200, 300, 400], bad: null });
    expect(parseStagger("100, 2o0")).toEqual({ values: [], bad: "2o0" });
  });

  it("shows the range a Mode matches, delta included", () => {
    expect(rangePreview("10", "20", "1", "µs")).toBe("Matches 9 – 21 µs");
    expect(rangePreview("10", "", "0", "µs")).toBe("Matches exactly 10 µs");
    expect(rangePreview("20", "10", "0", "µs")).toBeNull();
  });

  it("shows a stagger's steps and frame time", () => {
    expect(staggerPreview("100, 200", 300, "0")).toBe("2 steps · frame 300 µs");
    expect(staggerPreview("100, 200", 300, "5")).toBe("2 steps · frame 300 µs · matches 295 – 305 µs");
  });
});

describe("names", () => {
  it("suggests the next free number", () => {
    expect(nextFreeName("Search", ["Search 1", "Search 2"])).toBe("Search 3");
    expect(nameAfter("Track 7", ["Track 7", "Track 1"])).toBe("Track 2");
    expect(nameAfter("Acquire", ["Acquire"])).toBe("Acquire 2");
  });
});
