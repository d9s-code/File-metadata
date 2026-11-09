import { describe, expect, it } from "vitest";
import type { AmbiguityFinding, ComparedSide } from "../../api/ambiguity";
import {
  decidingText,
  directional,
  emitterPairGroups,
  modeChange,
  modeGroups,
  separationChange,
  separations,
  shareInside,
} from "./ambiguityAnalysis";

const side = (name: string, emitter = "E1") => ({
  mode_name: name,
  pri_type: "fixed",
  ew_group_id: "g",
  ew_group_name: "Search",
  source_id: "s",
  source_name: "Report",
  emitter_id: emitter,
  emitter_name: emitter === "E1" ? "Alpha" : "Bravo",
  platform_id: null,
  platform_name: null,
  line: {
    rf_min_mhz: 9000,
    rf_max_mhz: 9100,
    rf_delta: 1,
    pw_min_us: 1,
    pw_max_us: 2,
    pri_min_us: 990,
    pri_max_us: 1010,
    jitter_min_us: 0,
    jitter_max_us: 1,
    pri_stagger_values_us: null,
  },
});

const compared = (rf: [number, number], over: Partial<ComparedSide> = {}): ComparedSide => ({
  rf,
  pw: [1, 2],
  pri: [990, 1010],
  stagger: null,
  jitter: [0, 1],
  ...over,
});

function finding(
  id: string,
  a: string,
  b: string,
  rfA: [number, number],
  rfB: [number, number],
  over: Partial<AmbiguityFinding> = {},
  emitters: [string, string] = ["E1", "E1"],
): AmbiguityFinding {
  const shared = Math.max(0, Math.min(rfA[1], rfB[1]) - Math.max(rfA[0], rfB[0]));
  const rfPct = (100 * shared) / Math.min(rfA[1] - rfA[0], rfB[1] - rfB[0]);
  return {
    id,
    run_id: "r",
    mode_id_a: a,
    mode_id_b: b,
    rf_overlap_pct: Math.round(rfPct * 100) / 100,
    pw_overlap_pct: 100,
    pri_overlap_pct: 100,
    pri_comparison_type: "fixed-fixed",
    combined_severity: rfPct >= 70 ? "high" : rfPct >= 30 ? "medium" : "low",
    details: {
      mode_a: side(a, emitters[0]),
      mode_b: side(b, emitters[1]),
      margins_applied: true,
      limiting: "rf",
      jitter_overlap_pct: 100,
      pri_basis: "range",
      compared: { mode_a: compared(rfA), mode_b: compared(rfB) },
    },
    reviewed_by: null,
    reviewed_at: null,
    reviewer_note: null,
    ai_explanation: null,
    resolution: null,
    ...over,
  };
}

describe("shareInside", () => {
  it("is the share of the first range the second covers", () => {
    expect(shareInside([0, 10], [5, 20])).toBe(0.5);
    expect(shareInside([5, 20], [0, 10])).toBeCloseTo(1 / 3);
    expect(shareInside([3, 3], [0, 10])).toBe(1);
    expect(shareInside([30, 30], [0, 10])).toBe(0);
  });
});

describe("directional", () => {
  it("tells a narrow Mode inside a wide one from the reverse", () => {
    const f = finding("f", "Narrow", "Wide", [9040, 9060], [9000, 9200]);
    const d = directional(f);
    expect(d.aInB).toBe(1);
    expect(d.bInA).toBeCloseTo(0.1);
  });
});

describe("separations", () => {
  it("finds the smallest edge move that separates on RF", () => {
    const f = finding("f", "F0", "F1", [8999, 9101], [9019, 9121]);
    const [rf] = separations(f);
    expect(rf.param).toBe("rf");
    expect(rf.options[0]).toMatchObject({ amount: 82 });
    // Either F0's max down to 9,019 or F1's min up to 9,101.
    expect(rf.options.map((o) => `${o.side}.${o.edge}`).sort()).toEqual(["a.max", "b.min"]);
  });

  it("can't separate identical ranges by moving one edge", () => {
    const f = finding("f", "F0", "F1", [9000, 9100], [9000, 9100]);
    expect(separations(f).find((s) => s.param === "rf")?.identical).toBe(true);
  });

  it("turns a move into the typed value, taking off the Mode's delta", () => {
    const f = finding("f", "F0", "F1", [8999, 9101], [9019, 9121]);
    const move = separations(f)[0].options.find((o) => o.side === "a") ?? separations(f)[0].options[0];
    // F0's typed max with its ± 1 delta: 9,019 − 1.
    expect(separationChange(f, { ...move, side: "a", edge: "max", target: 9019 }, { rf_delta: 1 })).toEqual({
      rfMax: "9018",
    });
  });
});

describe("decidingText", () => {
  it("names the one parameter that still tells them apart", () => {
    expect(decidingText(finding("f", "F0", "F1", [8999, 9101], [9019, 9121]))).toBe("Only RF 80% — the rest overlap fully");
  });
});

describe("groups", () => {
  it("joins Modes through shared findings", () => {
    const fs = [
      finding("1", "F0", "F1", [0, 10], [5, 15]),
      finding("2", "F1", "F2", [5, 15], [12, 20]),
      finding("3", "S0", "S1", [100, 110], [105, 120]),
    ];
    const groups = modeGroups(fs);
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.modes.map((m) => m.name).join(","))).toContain("F0,F1,F2");
    expect(groups[0].deciding).toBe("rf");
  });

  it("files findings by pair of Emitters", () => {
    const fs = [
      finding("1", "A1", "B1", [0, 10], [5, 15], {}, ["E1", "E2"]),
      finding("2", "A2", "B2", [0, 10], [5, 15], {}, ["E2", "E1"]),
    ];
    const groups = emitterPairGroups(fs);
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe("Alpha ↔ Bravo");
  });
});

describe("modeChange", () => {
  const f = finding("f", "F0", "F1", [0, 10], [5, 15]);
  it("sees an edited or deleted Mode", () => {
    const line = { ...f.details.mode_a.line };
    expect(modeChange(f.details.mode_a, [{ id: "F0", pri_type: "fixed", line }], "F0")).toBeNull();
    expect(modeChange(f.details.mode_a, [{ id: "F0", pri_type: "fixed", line: { ...line, rf_max_mhz: 9050 } }], "F0")).toBe(
      "changed",
    );
    expect(modeChange(f.details.mode_a, [], "F0")).toBe("gone");
    expect(modeChange(f.details.mode_a, undefined, "F0")).toBeNull();
  });
});
