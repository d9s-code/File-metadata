import { describe, expect, it } from "vitest";
import type { Mode } from "../../types/domain";
import { TEST_CHECKS, matchEntry, type MatchableEntry } from "./interceptMatch";

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
