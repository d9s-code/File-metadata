import { describe, expect, it } from "vitest";
import type { ParamMiss } from "../intercepts/interceptMatch";
import { summarizeMisses } from "./NearMissEdit";

const pw = (value: number): ParamMiss => ({ param: "PW", label: "PW", value, min: 0.6, max: 1.5, unit: "µs" });

describe("summarizeMisses", () => {
  it("one set: as it is", () => {
    expect(summarizeMisses([pw(1.62)])).toBe("PW 0.12 µs above");
  });
  it("the same value off over several sets: once, as a range", () => {
    expect(summarizeMisses([pw(1.62), pw(1.58)])).toBe("PW 0.08–0.12 µs above, 2 sets");
  });
  it("off on different sides: each said", () => {
    expect(summarizeMisses([pw(1.62), pw(0.5)])).toBe("PW 0.12 µs above; PW 0.1 µs below");
  });
});
