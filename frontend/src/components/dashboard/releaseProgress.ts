import type { ReleaseEmitter } from "../../api/dashboard";

/** How far the current MDF's Emitters are from done, for the dashboard. An
 * Emitter is done when it's Operational with nothing left to fix. */

/** Why an Emitter isn't done, worst first: 0 is wrong now (missed lines, rework),
 * 1 is out of date (never or not since tested, pinned behind), 2 is missing
 * (no SIM Test Lines), 3 is simply not Operational yet. */
export interface Reason {
  rank: 0 | 1 | 2 | 3;
  text: string;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function reasons(e: ReleaseEmitter, statusName: (status: string) => string): Reason[] {
  const out: Reason[] = [];
  const sim = e.sim;
  const lines = sim?.line_count ?? 0;
  const wrong = sim ? sim.line_outcomes.fail + sim.line_outcomes.partial : 0;
  if (wrong) out.push({ rank: 0, text: `${plural(wrong, "SIM Test Line")} missed or partial` });
  if (e.status === "deprecated") out.push({ rank: 0, text: statusName("deprecated") });
  if (!lines) out.push({ rank: 2, text: "No SIM Test Lines" });
  else if (!sim?.last_validated_at) out.push({ rank: 1, text: "Never simulation-tested" });
  else if (sim.changed_since_validation) out.push({ rank: 1, text: "Changed since its last SIM run" });
  if (e.latest_version && e.latest_version > e.pinned_version) {
    out.push({ rank: 1, text: `Pinned v${e.pinned_version}, v${e.latest_version} saved` });
  }
  if (!out.length && e.status !== "validated") {
    out.push({ rank: 3, text: `${statusName(e.status ?? "draft")}, not Operational yet` });
  }
  return out.sort((a, b) => a.rank - b.rank);
}

export interface NextUp {
  emitter: ReleaseEmitter;
  reasons: Reason[];
}

/** Every Emitter that isn't done, the furthest from done first: by its worst
 * reason, then by how many reasons, then by name. */
export function notDone(emitters: ReleaseEmitter[], statusName: (status: string) => string): NextUp[] {
  return emitters
    .map((emitter) => ({ emitter, reasons: reasons(emitter, statusName) }))
    .filter((x) => x.reasons.length > 0)
    .sort(
      (a, b) =>
        a.reasons[0].rank - b.reasons[0].rank ||
        b.reasons.length - a.reasons.length ||
        a.emitter.name.localeCompare(b.emitter.name, undefined, { numeric: true, sensitivity: "base" }),
    );
}

export interface ReleaseTotals {
  operational: number;
  byStatus: [string, number][];
  sim: { pass: number; partial: number; fail: number; untested: number };
  behind: number;
  neverTested: number;
  noLines: number;
  nobodyOnIt: number;
}

/** The whole MDF in a few numbers. */
export function releaseTotals(emitters: ReleaseEmitter[], statusName: (status: string) => string): ReleaseTotals {
  const byStatus = new Map<string, number>();
  const sim = { pass: 0, partial: 0, fail: 0, untested: 0 };
  for (const e of emitters) {
    const status = e.status ?? "draft";
    byStatus.set(status, (byStatus.get(status) ?? 0) + 1);
    const o = e.sim?.line_outcomes;
    if (o) {
      sim.pass += o.pass;
      sim.partial += o.partial;
      sim.fail += o.fail;
      sim.untested += o.untested + o.inconclusive + o.outdated;
    }
  }
  const done = new Set(notDone(emitters, statusName).map((x) => x.emitter.emitter_id));
  return {
    operational: emitters.filter((e) => e.status === "validated").length,
    byStatus: [...byStatus.entries()],
    sim,
    behind: emitters.filter((e) => e.latest_version && e.latest_version > e.pinned_version).length,
    neverTested: emitters.filter((e) => (e.sim?.line_count ?? 0) > 0 && !e.sim?.last_validated_at).length,
    noLines: emitters.filter((e) => !(e.sim?.line_count ?? 0)).length,
    nobodyOnIt: emitters.filter((e) => done.has(e.emitter_id) && !e.assignee).length,
  };
}
