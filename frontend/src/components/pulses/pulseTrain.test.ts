import { describe, expect, it } from "vitest";
import { modeTrain, ownDuty, timeForPulses, timelineTrain } from "./pulseTrain";

describe("pulse trains", () => {
  it("a Fixed PRI: k pulses take k gaps", () => {
    const t = modeTrain([1000])!;
    expect(t.periodUs).toBe(1000);
    expect(timeForPulses(t, 8)).toBe(8000);
  });

  it("a stagger: the longest run of k steps", () => {
    const t = modeTrain([300, 400, 500])!;
    expect(t.periodUs).toBe(1200);
    // From just after the 300 µs step's pulse: 400 + 500 = 900 for two.
    expect(timeForPulses(t, 2)).toBe(900);
    expect(timeForPulses(t, 3)).toBe(1200);
  });

  it("pulse groups: enough of a group, or across groups when it's short", () => {
    // 8 pulses 100 µs apart, then off 2 ms: a 2.8 ms period.
    const t = modeTrain([100], 8, 2)!;
    expect(t.periodUs).toBe(2800);
    expect(t.pulses).toHaveLength(8);
    // 4 pulses: worst starts just before the gap — 3 more in the group can't do it, so it waits it out.
    expect(timeForPulses(t, 4)).toBe(2100 + 300 + 100 - 100);
    // 8 pulses is a whole period's worth.
    expect(timeForPulses(t, 8)).toBe(2800);
    expect(ownDuty(t)).toBeCloseTo(800 / 2800, 6);
  });

  it("a timeline: this Mode's groups, the others', off times; repeating", () => {
    const t = timelineTrain([
      { kind: "group", mode_name: "A", own: true, pulses: 4, steps_us: [100] },
      { kind: "group", mode_name: "B", pulses: 2, steps_us: [250] },
      { kind: "off", ms: 1 },
    ])!;
    expect(t.periodUs).toBe(400 + 500 + 1000);
    expect(t.pulses.filter((p) => p.own)).toHaveLength(4);
    expect(t.segments.map((s) => s.kind)).toEqual(["group", "group", "off"]);
    // Four of A: from just after its first pulse, the next round's first.
    expect(timeForPulses(t, 4)).toBe(1900);
    // A group for a time: as many pulses as fit.
    const timed = timelineTrain([{ kind: "group", mode_name: "A", own: true, ms: 1, steps_us: [300] }])!;
    expect(timed.pulses).toHaveLength(4);
    expect(timed.periodUs).toBe(1000);
  });

  it("none of its own: never", () => {
    const t = timelineTrain([{ kind: "group", mode_name: "B", pulses: 2, steps_us: [250] }])!;
    expect(timeForPulses(t, 1)).toBe(Infinity);
  });
});
