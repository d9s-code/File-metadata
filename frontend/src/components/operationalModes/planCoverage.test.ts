import { describe, expect, it } from "vitest";
import { buildTree } from "./opTree";
import { asModeCombination, combinations, comboText, covers, effectivePlan, planCoverage } from "./planCoverage";
import type { OperationalMode } from "../../api/operationalModes";
import type { Mode } from "../../types/domain";

const op = (id: string, name: string, parent: string | null, plan: OperationalMode["plan"] = null): OperationalMode => ({
  id,
  emitter_id: "e",
  parent_id: parent,
  name,
  description: null,
  illumination_time_ms: null,
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
    const cov = planCoverage(byId.get("t")!, byId)!;
    expect(cov.valueCovered.pri).toEqual([true, true, false]);
    expect(cov.uncovered).toBe(1);
    expect(comboText(cov.combos.find((c) => !c.mode)!.combo)).toBe("RF 9400–9450 MHz · PRI 150 µs · PW 1 µs");
    // TRACK plans RF and PW only: both covered.
    expect(planCoverage(byId.get("track")!, byId)!.uncovered).toBe(0);
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
});
