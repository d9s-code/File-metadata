import { describe, expect, it } from "vitest";
import type { EwGroup, Mode, ModeLine, Source } from "../../types/domain";
import {
  batchSpan,
  compareModes,
  groupModesForDisplay,
  jitterOrFrameTimeDisplay,
  priTypeLabel,
  rangeMatchingTags,
  rangeOverlaps,
  rfDisplay,
  spanText,
} from "./modeFormat";

const mode = (over: Omit<Partial<Mode>, "line"> & { line?: Partial<ModeLine> }): Mode =>
  ({ id: over.name ?? "m", name: "M", pri_type: "fixed", ew_group_id: "g", source_id: "s", generation_batch_id: null, ...over }) as Mode;

describe("priTypeLabel", () => {
  it("reads as a word", () => {
    expect(["fixed", "stagger", "cw"].map(priTypeLabel)).toEqual(["Fixed", "Stagger", "CW"]);
  });
});

describe("displays", () => {
  const m = mode({
    line: { rf_min_mhz: 3000, rf_max_mhz: 3100, rf_delta: 5, engineered_rf_min_mhz: 2995, engineered_rf_max_mhz: 3105, jitter_min_us: 0, jitter_max_us: 2 },
  });

  it("shows RF as typed with its delta, or engineered", () => {
    expect(rfDisplay(m, false)).toEqual({ min: 3000, max: 3100, delta: 5 });
    expect(rfDisplay(m, true)).toEqual({ min: 2995, max: 3105, delta: null });
  });

  it("puts jitter (Fixed) and frame time (Stagger) in the same columns", () => {
    expect(jitterOrFrameTimeDisplay(m, false)).toEqual({ min: 0, max: 2, label: "jitter", delta: null });
    const s = mode({ pri_type: "stagger", line: { frame_time_us: 1500, frame_time_delta_us: 3 } });
    expect(jitterOrFrameTimeDisplay(s, false)).toEqual({ min: 1500, max: null, label: "frametime", delta: 3 });
  });

  it("lists the parameters with range matching", () => {
    expect(rangeMatchingTags(mode({ line: { rf_range_matching: true, pw_range_matching: true } }))).toEqual(["RF", "PW"]);
    expect(rangeMatchingTags(mode({}))).toEqual([]);
  });
});

describe("rangeOverlaps", () => {
  it("keeps everything with no filter and Modes overlapping the filter", () => {
    expect(rangeOverlaps("", "", null, null)).toBe(true);
    expect(rangeOverlaps("2900", "", 2800, 2950)).toBe(true);
    expect(rangeOverlaps("", "2700", 2800, 2950)).toBe(false);
    expect(rangeOverlaps("1", "2", null, 5)).toBe(false);
  });
});

describe("groupModesForDisplay", () => {
  const modes = [
    mode({ name: "A", generation_batch_id: "b1" }),
    mode({ name: "B" }),
    mode({ name: "C", generation_batch_id: "b1" }),
    mode({ name: "D", generation_batch_id: "b2" }),
  ];

  it("collapses a batch of two or more into one row where its first Mode was", () => {
    const rows = groupModesForDisplay(modes, true);
    expect(rows.map((r) => (r.type === "batch" ? `batch:${r.modes.map((x) => x.name).join("")}` : r.mode.name))).toEqual(["batch:AC", "B", "D"]);
  });

  it("leaves every Mode on its own row when not collapsing", () => {
    expect(groupModesForDisplay(modes, false)).toHaveLength(4);
  });
});

describe("compareModes", () => {
  const groups = { g: { id: "g", name: "Main" } as EwGroup };
  const sources: Record<string, Source> = {};
  const sort = (list: Mode[], key: Parameters<typeof compareModes>[2], dir: "asc" | "desc") =>
    [...list].sort((a, b) => compareModes(a, b, key, dir, groups, sources)).map((m) => m.name);

  it("sorts names the natural way", () => {
    const list = ["Mode 10", "Mode 2", "mode 1"].map((name) => mode({ name }));
    expect(sort(list, "name", "asc")).toEqual(["mode 1", "Mode 2", "Mode 10"]);
  });

  it("puts Modes without the value last in either direction, ties by name", () => {
    const list = [
      mode({ name: "S", pri_type: "stagger", line: {} }),
      mode({ name: "B", line: { pri_min_us: 900 } }),
      mode({ name: "A", line: { pri_min_us: 900 } }),
      mode({ name: "C", line: { pri_min_us: 800 } }),
    ];
    expect(sort(list, "pri_min", "asc")).toEqual(["C", "A", "B", "S"]);
    expect(sort(list, "pri_min", "desc")).toEqual(["A", "B", "C", "S"]);
  });
});

describe("batchSpan", () => {
  it("gives the lowest and highest of each parameter across a batch, stagger steps in PRI", () => {
    const modes = [
      mode({ name: "A", line: { rf_min_mhz: 9000, rf_max_mhz: 9100, pri_min_us: 200, pri_max_us: 210, pw_min_us: 1, pw_max_us: 1.5, rf_delta: 5 } }),
      mode({ name: "B", line: { rf_min_mhz: 9400, rf_max_mhz: 9500, pri_min_us: 300, pri_max_us: 310, pw_min_us: 0.5, pw_max_us: 1, rf_delta: 10 } }),
      mode({ name: "C", pri_type: "stagger", line: { rf_min_mhz: 9200, rf_max_mhz: 9300, pri_stagger_values_us: [150, 400], pw_min_us: 2, pw_max_us: 2 } }),
    ];
    const s = batchSpan(modes, false);
    expect(s.rf).toEqual([9000, 9500]);
    expect(s.pri).toEqual([150, 400]);
    expect(s.pw).toEqual([0.5, 2]);
    expect(s.rfDelta).toEqual([5, 10]);
    expect(s.priTypes).toEqual(["Fixed", "Stagger"]);
    expect(spanText(s.rf, "MHz")).toBe("9000–9500 MHz");
    expect(spanText([3, 3])).toBe("3");
    expect(spanText(batchSpan([mode({ name: "D", pri_type: "cw", line: {} })], false).pri)).toBe("—");
  });
});
