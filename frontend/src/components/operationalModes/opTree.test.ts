import { describe, expect, it } from "vitest";
import { below, buildTree, flatten, modeParams, ownParams } from "./opTree";
import type { OperationalMode } from "../../api/operationalModes";
import type { Mode } from "../../types/domain";

const op = (id: string, name: string, parent: string | null = null, ms: number | null = null): OperationalMode => ({
  id,
  emitter_id: "e",
  parent_id: parent,
  name,
  description: null,
  illumination_time_ms: ms,
  sort_order: 0,
  modes_count: 0,
  created_at: "",
  updated_at: "",
});
const mode = (id: string, opId: string | null, pri: number, rf: [number, number] = [9400, 9450]): Mode =>
  ({
    id,
    name: id,
    pri_type: "fixed",
    operational_mode_id: opId,
    scan_min_s: null,
    scan_max_s: null,
    line: { rf_min_mhz: rf[0], rf_max_mhz: rf[1], pw_min_us: 1, pw_max_us: 1, pri_min_us: pri, pri_max_us: pri, jitter_min_us: 0, jitter_max_us: 0 },
  }) as unknown as Mode;

const ops = [op("track", "TRACK", null, 30), op("t1", "Track 1", "track"), op("t2", "Track 2", "track"), op("t10", "Track 10", "track", 12)];
const modes = [mode("T1", "t1", 100), mode("T2", "t2", 120), mode("T10", "t10", 150), mode("Lone", null, 1000, [3000, 3100])];

describe("the radar as a tree", () => {
  it("puts Track 1, 2, 10 under TRACK, in number order, and the unlinked aside", () => {
    const { roots, unlinked } = buildTree(ops, modes);
    expect(roots.map((r) => r.op.name)).toEqual(["TRACK"]);
    expect(roots[0].children.map((c) => c.op.name)).toEqual(["Track 1", "Track 2", "Track 10"]);
    expect(roots[0].allModes.map((m) => m.name).sort()).toEqual(["T1", "T10", "T2"]);
    expect(unlinked.map((m) => m.name)).toEqual(["Lone"]);
    expect(flatten(roots).map((x) => [x.path, x.depth])).toEqual([
      ["TRACK", 0],
      ["TRACK › Track 1", 1],
      ["TRACK › Track 2", 1],
      ["TRACK › Track 10", 1],
    ]);
  });

  it("shows what they share on TRACK, and what differs on each", () => {
    const { roots, byId } = buildTree(ops, modes);
    const track = roots[0];
    expect(track.shownHere.rf).toBe("9400–9450 MHz");
    expect(track.shownHere.pri).toBeUndefined();
    // Each Track holds one Mode: its PRI is shown there, the RF not again.
    expect(byId.get("t2")!.shownHere).toEqual({ pri: "120 µs" });
    // A Mode right under TRACK would show its own PRI, not the RF.
    expect(ownParams(modes[1], track)).toMatchObject({ pri: "120 µs" });
    expect(ownParams(modes[1], track).rf).toBeUndefined();
    // None of them has a jitter or a scan box: nothing to say, anywhere.
    expect(track.shownHere.jitter).toBeUndefined();
    expect(ownParams(modes[1], track).jitter).toBeUndefined();
  });

  it("an illumination time is its own, else the nearest one above it", () => {
    const { byId } = buildTree(ops, modes);
    expect([byId.get("t2")!.illuminationMs, byId.get("t2")!.illuminationFrom]).toEqual([30, "TRACK"]);
    expect([byId.get("t10")!.illuminationMs, byId.get("t10")!.illuminationFrom]).toEqual([12, "Track 10"]);
  });

  it("a loop or a missing parent can't hide one", () => {
    const { roots } = buildTree([op("a", "A", "b"), op("b", "B", "a"), op("c", "C", "gone")], []);
    expect(flatten(roots).map((x) => x.op.name).sort()).toEqual(["A", "B", "C"]);
    expect([...below(roots.find((r) => r.op.name === "C")!)]).toEqual(["c"]);
  });

  it("a Mode's values, as shown", () => {
    expect(modeParams(mode("x", null, 100))).toMatchObject({ pri_type: "Fixed", rf: "9400–9450 MHz", pri: "100 µs", jitter: "—", scan: "—" });
  });
});
