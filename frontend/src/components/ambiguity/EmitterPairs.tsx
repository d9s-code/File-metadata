import { useMemo } from "react";
import type { AmbiguityFinding, AmbiguitySeverity } from "../../api/ambiguity";
import { SeverityBadge } from "./SeverityBadge";
import { SEVERITY_ORDER, SEVERITY_RANK, findingStatus } from "./ambiguityText";

export type EmitterPair = [string, string];

/** The key a pair of Emitters is filed under, whichever way round. */
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

interface PairRow {
  key: string;
  ids: EmitterPair;
  names: [string, string];
  counts: Record<AmbiguitySeverity, number>;
  worst: AmbiguitySeverity;
  open: number;
  total: number;
  modes: number;
}

interface EmitterRow {
  id: string;
  name: string;
  worst: AmbiguitySeverity;
  open: number;
  /** The other Emitters it could be taken for, worst first. */
  with: { id: string; name: string; worst: AmbiguitySeverity }[];
}

const blank = (): Record<AmbiguitySeverity, number> => ({ exact_overlap: 0, high: 0, medium: 0, low: 0, none: 0 });
const worse = (a: AmbiguitySeverity, b: AmbiguitySeverity) => (SEVERITY_RANK[a] <= SEVERITY_RANK[b] ? a : b);

/** Which Emitters could be taken for each other: one line per Emitter with
 * the others it overlaps, then one line per pair with how badly — the
 * Platform/MDF answer, before the Mode-by-Mode findings. */
export function EmitterPairs({
  findings,
  onPick,
}: {
  findings: AmbiguityFinding[];
  onPick: (pair: EmitterPair, names: [string, string]) => void;
}) {
  const { pairs, emitters } = useMemo(() => {
    const byKey = new Map<string, PairRow & { modeIds: Set<string> }>();
    for (const f of findings) {
      const { mode_a: a, mode_b: b } = f.details;
      if (a.emitter_id === b.emitter_id) continue;
      const [first, second] = a.emitter_id < b.emitter_id ? [a, b] : [b, a];
      const key = pairKey(a.emitter_id, b.emitter_id);
      const row =
        byKey.get(key) ??
        {
          key,
          ids: [first.emitter_id, second.emitter_id] as EmitterPair,
          names: [first.emitter_name, second.emitter_name] as [string, string],
          counts: blank(),
          worst: "none" as AmbiguitySeverity,
          open: 0,
          total: 0,
          modes: 0,
          modeIds: new Set<string>(),
        };
      row.counts[f.combined_severity] += 1;
      row.worst = worse(row.worst, f.combined_severity);
      row.total += 1;
      if (findingStatus(f) === "open") row.open += 1;
      row.modeIds.add(f.mode_id_a).add(f.mode_id_b);
      row.modes = row.modeIds.size;
      byKey.set(key, row);
    }
    const pairs = [...byKey.values()].sort(
      (x, y) => SEVERITY_RANK[x.worst] - SEVERITY_RANK[y.worst] || y.open - x.open || y.total - x.total,
    );

    const byEmitter = new Map<string, EmitterRow>();
    for (const p of pairs) {
      for (const i of [0, 1] as const) {
        const other = 1 - i;
        const row = byEmitter.get(p.ids[i]) ?? { id: p.ids[i], name: p.names[i], worst: "none", open: 0, with: [] };
        row.worst = worse(row.worst, p.worst);
        row.open += p.open;
        row.with.push({ id: p.ids[other], name: p.names[other], worst: p.worst });
        byEmitter.set(p.ids[i], row);
      }
    }
    const emitters = [...byEmitter.values()].sort(
      (x, y) => SEVERITY_RANK[x.worst] - SEVERITY_RANK[y.worst] || y.with.length - x.with.length || x.name.localeCompare(y.name),
    );
    return { pairs, emitters };
  }, [findings]);

  if (pairs.length === 0) return <p className="hint-text">No findings match these filters.</p>;

  return (
    <div className="emitter-pairs">
      <h4>Ambiguous Emitters</h4>
      <p className="hint-text">
        {emitters.length} Emitter{emitters.length === 1 ? "" : "s"} could be taken for another — each with the Emitters it
        overlaps, worst first.
      </p>
      <table className="data-table">
        <thead>
          <tr>
            <th>Emitter</th>
            <th>Worst</th>
            <th>Could be taken for</th>
            <th className="num">Open findings</th>
          </tr>
        </thead>
        <tbody>
          {emitters.map((e) => (
            <tr key={e.id}>
              <td>{e.name}</td>
              <td>
                <SeverityBadge severity={e.worst} />
              </td>
              <td>
                {e.with.map((w, i) => (
                  <span key={w.id}>
                    {i > 0 && ", "}
                    <button
                      type="button"
                      className="link-button"
                      title="Show the Modes behind this pair"
                      onClick={() => onPick([e.id, w.id], [e.name, w.name])}
                    >
                      {w.name}
                    </button>{" "}
                    <SeverityBadge severity={w.worst} />
                  </span>
                ))}
              </td>
              <td className="num">{e.open}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h4>Emitter pairs</h4>
      <p className="hint-text">Every pair of Emitters with Modes that overlap. Click one for the Mode pairs behind it.</p>
      <table className="data-table modes-involved">
        <thead>
          <tr>
            <th>Emitters</th>
            {SEVERITY_ORDER.map((s) => (
              <th key={s} className="num">
                <SeverityBadge severity={s} />
              </th>
            ))}
            <th className="num">Open</th>
            <th className="num">Mode pairs</th>
            <th className="num">Modes</th>
          </tr>
        </thead>
        <tbody>
          {pairs.map((p) => (
            <tr key={p.key} className="modes-involved-row" onClick={() => onPick(p.ids, p.names)} title="Show the Mode pairs">
              <td>
                <button type="button" className="link-button">
                  {p.names[0]} ↔ {p.names[1]}
                </button>
              </td>
              {SEVERITY_ORDER.map((s) => (
                <td key={s} className="num">
                  {p.counts[s] || ""}
                </td>
              ))}
              <td className="num">{p.open}</td>
              <td className="num">{p.total}</td>
              <td className="num">{p.modes}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
