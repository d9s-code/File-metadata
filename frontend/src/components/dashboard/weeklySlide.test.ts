import { describe, expect, it } from "vitest";
import type { WeeklyUpdate } from "../../api/reports";
import { grid, periodText, sectionItems, slideSvg, wrap, SLIDE_H, SLIDE_W } from "./weeklySlide";

// About Inter's width: 0.55 em a character (bold a little wider).
const measure = (text: string, size: number, weight: number) => text.length * size * (weight >= 600 ? 0.6 : 0.55);

const week: WeeklyUpdate = {
  start: "2026-11-12",
  end: "2026-11-18",
  mdf: {
    name: "Fleet",
    status: "In progress",
    customer: null,
    due_date: "2026-12-12",
    days_left: 24,
    emitters: 4,
    operational: 1,
    operational_week_ago: 0,
    by_status: [
      { key: "draft", label: "In progress", color: "grey", count: 3 },
      { key: "validated", label: "Operational", color: "green", count: 1 },
    ],
    sim: { pass: 3, partial: 1, fail: 0, untested: 2 },
    not_done: 3,
    next_up: [{ name: "Nav Radar", reason: "No SIM Test Lines", more: 1, assignee: "kim" }],
    log: [{ date: "2026-11-17", kind: "progress", body: "Fleet MDF on track.", author: "admin" }],
  },
  emitters: {
    status_moves: Array.from({ length: 30 }, (_, i) => ({ emitter: `Emitter ${i}`, from: "Testing", to: "Operational", to_key: "validated", date: "2026-11-17" })),
    to_operational: 30,
    to_rework: 0,
    modes: { added: 5, changed: 12, removed: 1 },
    emitters_touched: 3,
    busiest: [{ emitter: "Nav Radar", added: 3, changed: 2, removed: 0 }],
    versions: [{ emitter: "Nav Radar", version: 2, date: "2026-11-17" }],
    needs_rework: 1,
  },
  testing: {
    emitter_runs: 2,
    emitter_results: { pass: 1, partial: 0, fail: 1, inconclusive: 0 },
    platform_tests: 1,
    platform_results: { pass: 0, partial: 1, fail: 0, inconclusive: 0 },
    mdf_tests: 0,
    mdf_results: { pass: 0, partial: 0, fail: 0, inconclusive: 0 },
    mixups: 2,
  },
  outlook: { open_tasks: 7, overdue_tasks: 2, unassigned_tasks: 1 },
};

describe("the weekly slide", () => {
  it("reads the period plainly", () => {
    expect(periodText("2026-11-12", "2026-11-18")).toBe("12 – 18 Nov 2026");
    expect(periodText("2026-10-28", "2026-11-03")).toBe("28 Oct – 3 Nov 2026");
    expect(periodText("2025-12-29", "2026-01-04")).toBe("29 Dec 2025 – 4 Jan 2026");
  });

  it("lays one, two, three or four sections out on the slide", () => {
    expect(grid(1, 200).map((g) => g.w)).toEqual([SLIDE_W - 144]);
    expect(grid(3, 200).map((g) => g.y)).toEqual([200, 200, 200]);
    const four = grid(4, 200);
    expect(four[2].y).toBeGreaterThan(four[0].y);
    for (const g of four) expect(g.y + g.h).toBeLessThanOrEqual(SLIDE_H);
  });

  it("says what changed in the MDF this week", () => {
    const { items } = sectionItems("mdf", week);
    const stats = items.find((i) => i.kind === "stats");
    expect(stats && stats.kind === "stats" && stats.items[0]).toMatchObject({ value: "1/4", sub: "+1 this week", tone: "good" });
  });

  it("keeps a long list inside its card, with how many more", () => {
    const svg = slideSvg(week, { sections: ["mdf", "emitters", "testing", "outlook"], title: "Weekly progress update", note: "On track." }, measure);
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toMatch(/\+\d+ more/);
    // Every line of text is on the slide.
    for (const m of svg.matchAll(/<text x="([\d.]+)" y="([\d.]+)"/g)) {
      expect(Number(m[2])).toBeLessThanOrEqual(SLIDE_H);
      expect(Number(m[1])).toBeLessThanOrEqual(SLIDE_W);
    }
  });

  it("escapes what people typed", () => {
    expect(slideSvg(week, { sections: ["mdf"], title: "A & B <c>", note: "" }, measure)).toContain("A &amp; B &lt;c&gt;");
  });

  it("wraps at spaces", () => {
    expect(wrap("one two three four", 60, 10, 400, measure)).toEqual(["one two", "three four"]);
  });
});
