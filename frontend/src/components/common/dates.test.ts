import { describe, expect, it } from "vitest";
import { formatDate, formatDateTime, formatTime, isoDayToText, parseDayText, parseTimeText } from "./dates";

describe("dates", () => {
  it("formats day.month.year and a 24-hour clock", () => {
    expect(formatDate("2026-10-07")).toBe("07.10.2026");
    expect(formatDate(null)).toBe("—");
    expect(formatTime("9:05:00")).toBe("09:05");
    expect(formatDateTime(new Date(2026, 9, 7, 14, 5))).toBe("07.10.2026 14:05");
    expect(isoDayToText("2026-10-07")).toBe("07.10.2026");
  });

  it("reads an ISO day as that calendar day, whatever the time zone", () => {
    expect(formatDate("2026-01-01")).toBe("01.01.2026");
  });

  it("parses the ways people type a date", () => {
    for (const text of ["7.10.2026", "07.10.26", "7/10/2026", "7-10-2026", "07102026", "2026-10-07"]) {
      expect(parseDayText(text), text).toBe("2026-10-07");
    }
    expect(parseDayText("31.02.2026")).toBeNull();
    expect(parseDayText("soon")).toBeNull();
  });

  it("parses the ways people type a time", () => {
    expect(["14:05", "14.05", "1405", "14:5"].map(parseTimeText)).toEqual(["14:05", "14:05", "14:05", "14:05"]);
    expect(parseTimeText("24:00")).toBeNull();
  });
});
