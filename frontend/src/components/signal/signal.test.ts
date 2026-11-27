import { describe, expect, it } from "vitest";
import { codePhases, pulses, shareInBand, signalDraftFrom, signalPayload, signalProblem, signalShort } from "./signal";

describe("a Mode's signal", () => {
  it("round-trips through the form, keeping only what isn't plain", () => {
    const sig = {
      rf: { kind: "hopping" as const, channels_mhz: [9400, 9420], hop_pulses: 8, order: "random" as const },
      pri: { kind: "sliding" as const, period_ms: 20, shape: "up" as const },
      modulation: { kind: "phase" as const, code: "barker" as const, code_length: 13 },
      polarisation: "horizontal" as const,
    };
    const d = signalDraftFrom(sig);
    expect(signalProblem(d, true)).toBeNull();
    expect(signalPayload(d, true)).toEqual(sig);
    expect(signalPayload(signalDraftFrom(null), true)).toBeNull();
    // Not a Fixed PRI: no PRI behaviour.
    expect(signalPayload(d, false)?.pri).toBeUndefined();
    expect(signalShort(sig)).toBe("RF hopping, 2 ch · PRI sliding · Barker 13 · Horizontal");
  });

  it("says what's missing", () => {
    expect(signalProblem({ ...signalDraftFrom(null), rfKind: "hopping", channels: "9400" }, true)).toMatch(/two channels/);
    expect(signalProblem({ ...signalDraftFrom(null), modKind: "lfm" }, true)).toMatch(/bandwidth/);
    expect(signalProblem({ ...signalDraftFrom(null), priKind: "dwell_switch", priValues: "800, 900" }, true)).toMatch(/dwell/);
  });

  it("pulse by pulse: a sliding PRI climbs its range, hops land on channels, a sequence of PWs repeats", () => {
    const ps = pulses(
      { pri: { kind: "sliding", period_ms: 100, shape: "up" }, rf: { kind: "hopping", channels_mhz: [1, 2, 3], hop_pulses: 2 }, pw: { kind: "sequence", values_us: [1, 2] } },
      { rf: [1, 3], pri: [1000, 2000], pw: [1, 2] },
      10,
    );
    expect(ps[0].pri).toBe(1000);
    expect(ps[5].pri).toBeGreaterThan(ps[1].pri);
    expect(ps.map((p) => p.rf[0])).toEqual([1, 1, 2, 2, 3, 3, 1, 1, 2, 2]);
    expect(ps.map((p) => p.pw).slice(0, 4)).toEqual([1, 2, 1, 2]);
  });

  it("codes and shares", () => {
    expect(codePhases("barker", 13)).toHaveLength(13);
    expect(codePhases("frank", 16)).toHaveLength(16);
    expect(shareInBand({ rf: { kind: "agile" } }, [9300, 9500], 9350, 9450)).toBeCloseTo(0.5, 6);
    expect(shareInBand({ rf: { kind: "hopping", channels_mhz: [1, 2, 3, 4] } }, [1, 4], 0, 2.5)).toBe(0.5);
    expect(shareInBand(null, [1, 4], 0, 2.5)).toBeNull();
  });
});
