import { describe, expect, it } from "vitest";
import type { Mode } from "../../types/domain";
import { TEST_CHECKS, describeMiss, matchEntry, type MatchableEntry } from "./interceptMatch";

const stagger = (steps: number[]): Mode =>
  ({
    id: "m",
    name: "Stagger",
    pri_type: "stagger",
    line: {
      rf_min_mhz: 9000,
      rf_max_mhz: 9100,
      pw_min_us: 0.5,
      pw_max_us: 1.5,
      pri_stagger_values_us: steps,
      pri_range_matching: false,
      // A large frame-time delta must not widen each step.
      frame_time_delta_us: 10,
      frame_time_us: steps.reduce((a, b) => a + b, 0),
      engineered_frame_time_min_us: steps.reduce((a, b) => a + b, 0) - 10,
      engineered_frame_time_max_us: steps.reduce((a, b) => a + b, 0) + 10,
    },
  }) as unknown as Mode;

const logged = (steps: number[]): MatchableEntry => ({
  pri_type: "stagger",
  rf_mean_mhz: 9050,
  pw_mean_us: 1,
  pri_mean_us: steps.reduce((a, b) => a + b, 0),
  stagger_values: steps,
});

describe("stagger steps against a Mode", () => {
  const mode = stagger([100, 150, 200]);

  it("match within ± 1 µs per step", () => {
    expect(matchEntry(logged([100.8, 149.2, 201]), [mode], TEST_CHECKS).status).toBe("match");
  });

  it("miss beyond it, whatever the frame-time delta", () => {
    expect(matchEntry(logged([102, 150, 200]), [mode], TEST_CHECKS).status).toBe("near");
  });

  it("take the admin's step buffer when given", () => {
    expect(matchEntry(logged([102, 150, 200]), [mode], { ...TEST_CHECKS, stepDelta: 2.5 }).status).toBe("match");
  });

  it("still start anywhere in the train", () => {
    expect(matchEntry(logged([150.5, 200, 99.6]), [mode], TEST_CHECKS).status).toBe("match");
  });
});

const fixed: Mode = {
  id: "f",
  name: "Search",
  pri_type: "fixed",
  line: { rf_min_mhz: 9060, rf_max_mhz: 9240, pw_min_us: 0.5, pw_max_us: 1.5, pri_min_us: 200, pri_max_us: 220, jitter_min_us: 0, jitter_max_us: 1 },
} as unknown as Mode;

const fixedLogged = (over: Partial<MatchableEntry>): MatchableEntry => ({
  pri_type: "fixed",
  rf_mean_mhz: 9100,
  pw_mean_us: 1,
  pri_mean_us: 210,
  jitter_mean_us: 0.5,
  ...over,
});

describe("near: exactly one value off", () => {
  it("one value off is near, and says how far", () => {
    const m = matchEntry(fixedLogged({ rf_mean_mhz: 9244 }), [fixed], TEST_CHECKS);
    expect(m.status).toBe("near");
    expect(describeMiss(m.near[0].misses[0])).toBe("RF 9244 MHz — 4 MHz above the Mode's 9060–9240");
  });

  it("PRI and jitter both off is two values, not near", () => {
    expect(matchEntry(fixedLogged({ pri_mean_us: 230, jitter_mean_us: 3 }), [fixed], TEST_CHECKS).status).toBe("none");
  });

  it("RF and PW both off is not near", () => {
    expect(matchEntry(fixedLogged({ rf_mean_mhz: 9300, pw_mean_us: 3 }), [fixed], TEST_CHECKS).status).toBe("none");
  });

  it("a stagger's frame time and its steps both off is not near", () => {
    const mode = stagger([100, 150, 200]);
    // Compared on both (not by the Mode's range matching, which looks at one).
    const both = { jitter: true, sequence: true };
    expect(matchEntry({ ...logged([130, 150, 200]), pri_mean_us: 480 }, [mode], both).status).toBe("none");
    // The steps alone off (frame time within its window): near.
    expect(matchEntry(logged([102, 150, 200]), [mode], both).status).toBe("near");
    // A different number of steps and the frame time off: two values.
    expect(matchEntry({ ...logged([100, 150]), pri_mean_us: 250 }, [mode], both).status).toBe("none");
  });
});
