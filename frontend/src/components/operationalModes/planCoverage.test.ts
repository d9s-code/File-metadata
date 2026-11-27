import { describe, expect, it } from "vitest";
import { buildTree } from "./opTree";
import { asModeCombination, combinations, comboText, covers, coversStagger, effectivePlan, planCoverage } from "./planCoverage";
import type { OperationalMode } from "../../api/operationalModes";
import type { Mode } from "../../types/domain";

const op = (id: string, name: string, parent: string | null, plan: OperationalMode["plan"] = null): OperationalMode => ({
  id,
  emitter_id: "e",
  parent_id: parent,
  name,
  description: null,
  scan_id: null,
  plan,
  sort_order: 0,
  modes_count: 0,
  created_at: "",
  updated_at: "",
});
const mode = (id: string, opId: string, pri: number, pw = 1, rf: [number, number] = [9400, 9450]): Mode =>
  ({
    id,
    name: id,
    pri_type: "fixed",
    operational_mode_id: opId,
    line: { rf_min_mhz: rf[0], rf_max_mhz: rf[1], rf_delta: 0, pw_min_us: pw, pw_max_us: pw, pw_delta: 0, pri_min_us: pri, pri_max_us: pri, pri_delta: 1 },
  }) as unknown as Mode;

const ops = [
  op("track", "TRACK", null, { rf: [{ min: 9400, max: 9450 }], pw: [{ min: 1 }] }),
  op("t", "Tracks", "track", { pri: [{ min: 100, dwell_pulses: 64 }, { min: 120 }, { min: 150 }], pri_dwell_switch: true }),
];

describe("a plan against the Modes", () => {
  it("takes what it doesn't plan from the one above it", () => {
    const { byId } = buildTree(ops, []);
    const plan = effectivePlan(byId.get("t")!, byId);
    expect(plan.from).toEqual({ rf: "TRACK", pri: "Tracks", pw: "TRACK" });
    expect(plan.dwellSwitch).toBe(true);
    expect(combinations(plan)).toHaveLength(3);
  });

  it("flags the values and combinations no Mode under it covers", () => {
    const modes = [mode("A", "t", 100), mode("B", "t", 120.5)]; // PRI 120.5 ±1 covers 120
    const { byId } = buildTree(ops, modes);
    const cov = planCoverage(byId.get("t")!, byId, 1)!;
    expect(cov.chips.map((c) => c.covered)).toEqual([true, true, false]);
    expect(cov.uncovered).toBe(1);
    expect(comboText(cov.combos.find((c) => !c.mode)!.combo)).toBe("RF 9400–9450 MHz · PRI 150 µs · PW 1 µs");
    // TRACK plans RF and PW only: both covered.
    expect(planCoverage(byId.get("track")!, byId, 1)!.uncovered).toBe(0);
  });

  it("a Mode covers a value only when it holds all of it", () => {
    const m = mode("A", "t", 100, 1, [9400, 9420]);
    expect(covers(m, "rf", { min: 9400, max: 9450 })).toBe(false);
    expect(covers(m, "rf", { min: 9405, max: 9415 })).toBe(true);
  });

  it("a combination as a Mode to make needs RF, PRI and PW", () => {
    expect(asModeCombination({ rf: { min: 1, max: 2 }, pri: { min: 3 }, pw: { min: 4 } })).toEqual({
      rf_min_mhz: 1,
      rf_max_mhz: 2,
      pri_min_us: 3,
      pri_max_us: 3,
      pw_min_us: 4,
      pw_max_us: 4,
    });
    expect(asModeCombination({ rf: { min: 1 } })).toBeNull();
  });

  it("a stagger matches its steps in order — from any step only with PRI range matching on", () => {
    const st = { steps: [300, 400, 500] };
    const stag = (steps: number[], rangeMatching = false) =>
      ({ id: "s", name: "S", pri_type: "stagger", operational_mode_id: "t", line: { pri_stagger_values_us: steps, pri_range_matching: rangeMatching } }) as unknown as Mode;
    expect(coversStagger(stag([300.5, 400, 499.5]), st, 1)).toBe(true);
    expect(coversStagger(stag([300, 400, 503]), st, 1)).toBe(false);
    expect(coversStagger(stag([400, 500, 300]), st, 1)).toBe(false);
    expect(coversStagger(stag([400, 500, 300], true), st, 1)).toBe(true);
    expect(coversStagger(stag([300, 400]), st, 1)).toBe(false);
  });

  it("PW paired with PRI: each PRI with its own PW, not every PRI with every PW", () => {
    const ops2 = [
      op("a", "A", null, {
        rf: [{ min: 9400 }],
        pri: [{ min: 100, pw_min: 1 }, { min: 120, pw_min: 2 }],
        pri_pw_paired: true,
      }),
    ];
    const { byId } = buildTree(ops2, [mode("M", "a", 100, 1, [9400, 9400]), mode("N", "a", 120, 1, [9400, 9400])]);
    const cov = planCoverage(byId.get("a")!, byId, 1)!;
    expect(cov.combos.map((c) => comboText(c.combo))).toEqual(["RF 9400 MHz · PRI 100 µs · PW 1 µs", "RF 9400 MHz · PRI 120 µs · PW 2 µs"]);
    // N has PRI 120 but PW 1: the 120 µs ↔ 2 µs pair isn't covered.
    expect(cov.chips.map((c) => [c.text, c.covered])).toEqual([
      ["9400 MHz", true],
      ["100 µs ↔ PW 1 µs", true],
      ["120 µs ↔ PW 2 µs", false],
    ]);
    expect(cov.uncovered).toBe(1);
  });

  it("a stagger with a PW per step makes a Stagger Mode spanning its PWs", () => {
    const plan = { values: { rf: [{ min: 9400, max: 9450 }] }, staggers: [{ steps: [300, 400], pw_steps: [1, 2], frame_time_delta_us: 2 }], from: {}, dwellSwitch: false, paired: true };
    const [c] = combinations(plan);
    expect(asModeCombination(c)).toEqual({
      rf_min_mhz: 9400,
      rf_max_mhz: 9450,
      pri_stagger_values_us: [300, 400],
      frame_time_delta_us: 2,
      pw_min_us: 1,
      pw_max_us: 2,
    });
  });
});
