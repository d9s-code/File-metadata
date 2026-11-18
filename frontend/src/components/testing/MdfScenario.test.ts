import { describe, expect, it } from "vitest";
import { presentPlatform, scenarioError, scenarioInput, scenarioResult, type PresentedDraft } from "./MdfScenario";
import { blankObserved } from "./ObservedEmitter";
import type { MdfScenarioOptions } from "../../api/testRecords";

const options: MdfScenarioOptions = {
  version_number: 1,
  platforms: [
    { platform_id: "frigate", platform_name: "Frigate", emitters: [{ emitter_id: "fire", emitter_name: "Fire Control", modes: ["Track"] }, { emitter_id: "a", emitter_name: "Shared A", modes: [] }] },
    { platform_id: "corvette", platform_name: "Corvette", emitters: [{ emitter_id: "nav", emitter_name: "Nav Radar", modes: ["Nav"] }] },
  ],
};

describe("an MDF test's scenario", () => {
  it("presents a Platform with all its Emitters on the air, nothing recorded", () => {
    const d = presentPlatform(options, "frigate");
    expect(Object.keys(d.emitters)).toEqual(["fire", "a"]);
    expect(scenarioResult([d])).toBe("inconclusive");
    expect(scenarioResult([])).toBeNull();
  });

  it("sends only the Emitters transmitting, and which Platform it was intercepted as", () => {
    const d: PresentedDraft = {
      platformId: "frigate",
      interceptedAs: "corvette",
      emitters: {
        fire: { ...blankObserved(), on: true, detected: "yes", reports: [{ emitterId: "nav", platformId: "corvette", expectedMode: "Track", reportedMode: "Nav" }] },
        a: { ...blankObserved(), on: false, detected: "yes", reportedSelf: true },
      },
    };
    const input = scenarioInput([d])!;
    expect(input.platforms[0].intercepted_as_platform_id).toBe("corvette");
    expect(input.platforms[0].intercepted_unknown).toBeUndefined();
    expect(input.platforms[0].emitters.map((e) => e.emitter_id)).toEqual(["fire"]);
    expect(input.platforms[0].emitters[0].reports?.[0]).toMatchObject({ reported_emitter_id: "nav", reported_platform_id: "corvette", reported_mode: "Nav" });
    expect(scenarioResult([d])).toBe("fail");
    expect(scenarioInput([{ ...d, interceptedAs: "unknown" }])!.platforms[0]).toMatchObject({ intercepted_unknown: true, intercepted_as_platform_id: undefined });
    expect(scenarioInput([])).toBeUndefined();
  });

  it("works out the worst of the Emitters and the verdicts", () => {
    const d: PresentedDraft = {
      platformId: "frigate",
      interceptedAs: "",
      emitters: {
        fire: { ...blankObserved(), on: true, detected: "yes", reportedSelf: true },
        a: { ...blankObserved(), on: true, detected: "no" },
      },
    };
    expect(scenarioResult([d])).toBe("fail");
    d.emitters.a = { ...d.emitters.a, on: false };
    expect(scenarioResult([d])).toBe("pass");
  });

  it("refuses a time to detect that isn't a number", () => {
    const d = presentPlatform(options, "frigate");
    d.emitters.fire = { ...d.emitters.fire, detected: "yes", timeToDetect: "soon" };
    expect(scenarioError([d])).toMatch(/seconds/);
    d.emitters.fire = { ...d.emitters.fire, on: false };
    expect(scenarioError([d])).toBeNull();
  });
});
