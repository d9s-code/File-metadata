import { describe, expect, it } from "vitest";
import type { ReleaseEmitter } from "../../api/dashboard";
import { notDone, reasons, releaseTotals } from "./releaseProgress";

const NAMES: Record<string, string> = { draft: "In progress", validated: "Operational", deprecated: "Needs rework" };
const name = (s: string) => NAMES[s] ?? s;

const emitter = (over: Partial<ReleaseEmitter> & { lines?: Partial<Record<string, number>>; tested?: boolean; changed?: boolean }): ReleaseEmitter => {
  const { lines, tested = true, changed = false, ...rest } = over;
  const outcomes = { pass: 0, partial: 0, fail: 0, inconclusive: 0, untested: 0, outdated: 0, ...lines };
  const count = Object.values(outcomes).reduce((a, b) => a + b, 0);
  return {
    emitter_id: rest.name ?? "e",
    name: "E",
    designation: null,
    status: "draft",
    pinned_version: 1,
    latest_version: 1,
    platforms: ["Frigate"],
    assignee: null,
    sim: {
      emitter_id: rest.name ?? "e",
      name: rest.name ?? "E",
      status: "draft",
      line_count: count,
      line_outcomes: outcomes,
      last_validated_at: tested ? "2026-10-01T10:00:00Z" : null,
      last_validated_result: null,
      last_validated_test_record_id: null,
      changed_since_validation: changed,
    },
    ...rest,
  } as ReleaseEmitter;
};

describe("reasons", () => {
  it("puts what's wrong now before what's out of date or missing", () => {
    const e = emitter({ lines: { pass: 2, fail: 3, partial: 1 }, latest_version: 3, pinned_version: 2 });
    expect(reasons(e, name).map((r) => r.text)).toEqual(["4 SIM Test Lines missed or partial", "Pinned v2, v3 saved"]);
  });

  it("says when lines were never run, or the Emitter changed since", () => {
    expect(reasons(emitter({ lines: { untested: 2 }, tested: false }), name)[0].text).toBe("Never simulation-tested");
    expect(reasons(emitter({ lines: { pass: 2 }, changed: true }), name)[0].text).toBe("Changed since its last SIM run");
    expect(reasons(emitter({ sim: null }), name)[0].text).toBe("No SIM Test Lines");
  });

  it("has nothing to say about an Operational Emitter with everything passing", () => {
    expect(reasons(emitter({ status: "validated", lines: { pass: 4 } }), name)).toEqual([]);
    expect(reasons(emitter({ lines: { pass: 4 } }), name)).toEqual([{ rank: 3, text: "In progress, not Operational yet" }]);
  });
});

describe("notDone and the totals", () => {
  const list = [
    emitter({ name: "Done", status: "validated", lines: { pass: 2 }, assignee: "kari" }),
    emitter({ name: "Quiet", lines: { pass: 2 } }),
    emitter({ name: "Missed", lines: { fail: 1, pass: 1 }, assignee: "ola" }),
    emitter({ name: "Behind", lines: { pass: 1 }, latest_version: 2 }),
    emitter({ name: "Bare", sim: null }),
  ];

  it("lists the Emitters not done, furthest from done first", () => {
    expect(notDone(list, name).map((x) => x.emitter.name)).toEqual(["Missed", "Behind", "Bare", "Quiet"]);
  });

  it("counts the whole MDF", () => {
    const t = releaseTotals(list, name);
    expect(t.operational).toBe(1);
    expect(Object.fromEntries(t.byStatus)).toEqual({ validated: 1, draft: 4 });
    expect(t.sim).toEqual({ pass: 6, partial: 0, fail: 1, untested: 0 });
    expect([t.behind, t.neverTested, t.noLines, t.nobodyOnIt]).toEqual([1, 0, 1, 3]);
  });
});
