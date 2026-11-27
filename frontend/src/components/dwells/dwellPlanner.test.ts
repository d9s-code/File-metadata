import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  addForUncovered,
  breakSynchronism,
  isWholeCollects,
  lengthenShort,
  needMs,
  plan,
  planMode,
  roundToCollects,
  uncoveredParts,
  wholeCollects,
  type PlannerDwell,
  type PlannerMode,
} from "./dwellPlanner";

const mode = (over: Partial<PlannerMode> = {}): PlannerMode => ({
  key: "m",
  emitterId: "e",
  emitterName: "Search",
  modeName: "S1",
  priType: "fixed",
  rf: [9400, 9400],
  longestIntervalUs: 1000, // 1 ms PRI: 8 pulses need 8 ms
  frameUs: null,
  scanS: null,
  priority: 1,
  confirmationQuantity: 1,
  ...over,
});
const dwell = (freq: number, time: number, collect = 50): PlannerDwell => ({ freq_mhz: freq, dwell_time_ms: time, collect_time_ms: collect });
const S = { ...DEFAULT_SETTINGS, horizonS: 10 };

describe("whole collects", () => {
  it("rounds a dwell up to whole collects", () => {
    expect(wholeCollects(120, 50)).toBe(150);
    expect(wholeCollects(100, 50)).toBe(100);
    expect(wholeCollects(8, 50)).toBe(50);
    expect(isWholeCollects(dwell(1, 120))).toBe(false);
    expect(isWholeCollects(dwell(1, 70, 0))).toBe(true);
    expect(roundToCollects([dwell(1, 120), dwell(2, 100)]).map((d) => d.dwell_time_ms)).toEqual([150, 100]);
  });
});

describe("what a Mode needs", () => {
  it("is its pulses × its longest gap; a stagger two frames at least; CW one collect", () => {
    expect(needMs(mode(), S, 50)).toBe(8);
    expect(needMs(mode({ priType: "stagger", longestIntervalUs: 300, frameUs: 3000 }), S, 50)).toBe(6);
    expect(needMs(mode({ priType: "cw", longestIntervalUs: null }), S, 50)).toBe(50);
  });
});

describe("coverage", () => {
  it("not reached at all", () => {
    const p = planMode(mode(), [dwell(3000, 100)], 10, S);
    expect(p.issue).toBe("not_covered");
    expect(p.pWithin).toBe(0);
  });

  it("partly reached: the share of its RF a band reaches", () => {
    const p = planMode(mode({ rf: [9000, 9100] }), [dwell(9050, 100)], 10, S);
    expect(p.coverage).toBeCloseTo(0.1);
    expect(p.issue).toBe("partly_covered");
    expect(uncoveredParts([9000, 9100], [dwell(9050, 100)], 10)).toEqual([
      { lo: 9000, hi: 9045 },
      { lo: 9055, hi: 9100 },
    ]);
  });

  it("dwells for the RF nothing reaches, side by side, long enough", () => {
    const plans = plan([mode({ rf: [9000, 9030], longestIntervalUs: 10_000 })], [], 10, S);
    const added = addForUncovered([], plans, 10, S);
    expect(added.map((d) => d.freq_mhz)).toEqual([9005, 9015, 9025]);
    // 8 pulses × 10 ms = 80 ms, as whole 50 ms collects: 100 ms.
    expect(added.every((d) => d.dwell_time_ms === 100 && d.collect_time_ms === 50)).toBe(true);
  });
});

describe("dwell length", () => {
  it("too short for its pulses, and lengthened to whole collects", () => {
    const m = mode({ longestIntervalUs: 10_000 }); // needs 80 ms
    const dwells = [dwell(9400, 50), dwell(3000, 50)];
    const p = planMode(m, dwells, 10, S);
    expect(p.issue).toBe("too_short");
    expect(p.recommendedMs).toBe(100);
    expect(lengthenShort(dwells, [p], S).map((d) => d.dwell_time_ms)).toEqual([100, 50]);
  });

  it("pulses needed in one collect: the collect must be long enough, the dwell whole collects of it", () => {
    const s = { ...S, within: "collect" as const };
    const m = mode({ longestIntervalUs: 10_000 }); // 80 ms in one collect
    const dwells = [dwell(9400, 200, 50)];
    const p = planMode(m, dwells, 10, s);
    expect(p.issue).toBe("too_short");
    const fixed = lengthenShort(dwells, [p], s)[0];
    expect(fixed.collect_time_ms).toBe(80);
    expect(fixed.dwell_time_ms).toBe(240);
  });
});

describe("intercept in time", () => {
  it("a radar on the Platform all the time is caught within a cycle", () => {
    const p = planMode(mode(), [dwell(9400, 100), dwell(3000, 900)], 10, S);
    expect(p.issue).toBe("ok");
    expect(p.pWithin).toBeCloseTo(1);
    expect(p.medianMs).toBeLessThanOrEqual(1000);
    expect(p.revisitMs).toBe(1000);
  });

  it("an illumination time too short to hold its pulses can't be caught however the dwells are set", () => {
    // 8 × 5 ms = 40 ms, but a 3° beam on a 1 s scan illuminates the Platform ~8 ms.
    const p = planMode(mode({ longestIntervalUs: 5000, scanS: [1, 1] }), [dwell(9400, 100), dwell(3000, 900)], 10, S);
    expect(p.issue).toBe("illumination_too_short");
    expect(p.illuminationMs).toBeCloseTo(8.33, 1);
  });

  it("synchronism: a 1 s cycle against a 2 s scan keeps missing most starting phases", () => {
    const dwells = [dwell(9400, 100), dwell(3000, 900)];
    const m = mode({ scanS: [2, 2] }); // illumination time ~16.7 ms a scan
    const p = planMode(m, dwells, 10, S);
    expect(p.issue).toBe("synchronism");
    expect(p.lockedOut).toBeGreaterThan(0.8);
    // Out of step with it (2.3 s), every phase is caught sooner or later.
    const q = planMode(mode({ scanS: [2.3, 2.3] }), dwells, 10, S);
    expect(q.lockedOut).toBe(0);
    expect(q.pWithin).toBeGreaterThan(p.pWithin);
  });

  it("one collect more on a dwell breaks the synchronism", () => {
    const dwells = [dwell(9400, 100), dwell(3000, 900)];
    const m = mode({ scanS: [2, 2] });
    const fix = breakSynchronism([m], dwells, 10, S);
    expect(fix).not.toBeNull();
    const after = planMode(m, fix!.dwells, 10, S);
    expect(after.lockedOut).toBe(0);
    // Still whole collects.
    expect(fix!.dwells.every(isWholeCollects)).toBe(true);
  });

  it("lists problems first", () => {
    const plans = plan([mode({ key: "a", modeName: "Fine" }), mode({ key: "b", modeName: "Missing", rf: [5000, 5000] })], [dwell(9400, 100), dwell(3000, 900)], 10, S);
    expect(plans.map((p) => p.issue)).toEqual(["not_covered", "ok"]);
  });

  it("its Emitter's illumination time, where set, instead of the beamwidth's", () => {
    const dwells = [dwell(9400, 100), dwell(3000, 900)];
    // A 1 s scan with a 3° beam: ~8 ms — too short for 8 × 5 ms.
    const m = mode({ longestIntervalUs: 5000, scanS: [1, 1] });
    expect(planMode(m, dwells, 10, S).illuminationFrom).toBe("beamwidth");
    // Its Emitter says 60 ms: long enough.
    const p = planMode({ ...m, illuminationTimeMs: 60 }, dwells, 10, S);
    expect(p.illuminationMs).toBe(60);
    expect(p.illuminationFrom).toBe("emitter");
    expect(p.issue).not.toBe("illumination_too_short");
    // Not scanning: no illumination time, whatever the Emitter says.
    expect(planMode({ ...m, scanS: null, illuminationTimeMs: 60 }, dwells, 10, S).illuminationFrom).toBeNull();
  });

  it("a Mode's scan's revisit is what it's played at, not its EW Group's whole range", () => {
    const dwells = [dwell(9400, 100), dwell(3000, 900)];
    // The group scans anywhere from 2 to 10 s; this function only at 2 s — locked out.
    const boxed = mode({ scanS: [2, 2], scanFrom: "mode", groupScanS: [2, 10] });
    expect(planMode(boxed, dwells, 10, S).issue).toBe("synchronism");
  });

  it("its scan's illumination time ahead of its Emitter's", () => {
    const dwells = [dwell(9400, 100), dwell(3000, 900)];
    const m = mode({ longestIntervalUs: 5000, scanS: [1, 1], illuminationTimeMs: 20 });
    // The Emitter's 20 ms is too short for 8 × 5 ms…
    expect(planMode(m, dwells, 10, S).issue).toBe("illumination_too_short");
    // …its scan's 60 ms isn't.
    const p = planMode({ ...m, scanName: "Track dwell", scanIlluminationMs: 60 }, dwells, 10, S);
    expect([p.illuminationMs, p.illuminationFrom]).toEqual([60, "scan"]);
    expect(p.issue).not.toBe("illumination_too_short");
    // A scan that can't work one out: the Emitter's.
    expect(planMode({ ...m, scanName: "Track dwell", scanIlluminationMs: null }, dwells, 10, S).illuminationFrom).toBe("emitter");
  });
});
