import { describe, expect, it } from "vitest";
import { blankObserved, observedInput, previewVerdicts, workedOut, type ObservedRun } from "./ObservedEmitter";

const o = (over: Partial<ObservedRun>): ObservedRun => ({ ...blankObserved(), ...over });
const mixup = { emitterId: "b", expectedMode: "", reportedMode: "" };

describe("workedOut — as the server works it out", () => {
  it("follows what was observed", () => {
    expect(workedOut(o({}))).toBeNull();
    expect(workedOut(o({ detected: "no" }))).toBe("fail");
    expect(workedOut(o({ detected: "yes", reportedSelf: true }))).toBe("pass");
    expect(workedOut(o({ detected: "yes", reportedSelf: true, reports: [mixup] }))).toBe("partial");
    expect(workedOut(o({ detected: "yes", reports: [mixup] }))).toBe("fail");
    expect(workedOut(o({ detected: "yes", reportedUnknown: true }))).toBe("fail");
    expect(workedOut(o({ detected: "yes" }))).toBe("inconclusive");
  });
});

describe("previewVerdicts", () => {
  it("counts what was detected, identified and mixed up", () => {
    const v = previewVerdicts([o({ detected: "yes", reportedSelf: true }), o({ detected: "yes", reports: [mixup] }), o({ detected: "no" })]);
    expect(v).toMatchObject({ detection: "partial", detected: 2, observed: 3, identification: "partial", identified: 1, mixups: "fail", mixup_count: 1 });
    expect(previewVerdicts([o({}), undefined])).toBeNull();
  });
});

describe("observedInput", () => {
  it("sends only what applies", () => {
    expect(observedInput(o({}))).toEqual({});
    expect(observedInput(o({ detected: "no", timeToDetect: "3" }))).toMatchObject({ detected: false, time_to_detect_s: undefined });
    expect(observedInput(o({ detected: "yes", timeToDetect: "1.5", dwellIndex: "2", reportedSelf: true, reports: [{ ...mixup, reportedMode: "M1" }] }))).toEqual({
      detected: true,
      time_to_detect_s: 1.5,
      dwell_index: 2,
      reported_self: true,
      reported_unknown: false,
      reports: [{ reported_emitter_id: "b", reported_platform_id: undefined, expected_mode: undefined, reported_mode: "M1" }],
    });
  });
});
