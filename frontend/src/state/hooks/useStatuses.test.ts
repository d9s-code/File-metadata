import { describe, expect, it } from "vitest";
import { emitterProgressWeights } from "./useStatuses";

describe("emitterProgressWeights — as the server weighs them", () => {
  it("the built-in statuses", () => {
    expect(emitterProgressWeights(["draft", "in_review", "partially_operational", "validated", "deprecated"])).toEqual([
      { key: "draft", pct: 0 },
      { key: "in_review", pct: 33 },
      { key: "partially_operational", pct: 67 },
      { key: "validated", pct: 100 },
      { key: "deprecated", pct: 0 },
    ]);
  });

  it("Needs rework listed first, a status of the Admin's, one after Operational", () => {
    expect(emitterProgressWeights(["deprecated", "draft", "signed_off", "validated", "archived"])).toEqual([
      { key: "draft", pct: 0 },
      { key: "signed_off", pct: 50 },
      { key: "validated", pct: 100 },
      { key: "archived", pct: 100 },
      { key: "deprecated", pct: 0 },
    ]);
  });
});
