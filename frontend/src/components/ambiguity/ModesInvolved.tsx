import { useMemo } from "react";
import type { AmbiguityFinding, AmbiguitySeverity } from "../../api/ambiguity";
import { SeverityBadge } from "./SeverityBadge";
import { SEVERITY_ORDER, findingStatus } from "./ambiguityText";

interface Row {
  id: string;
  name: string;
  emitter: string;
  counts: Record<AmbiguitySeverity, number>;
  open: number;
  total: number;
}

/** The Modes in the most findings, worst first — often fixing one Mode
 * clears many findings. Click one to see its findings. */
export function ModesInvolved({
  findings,
  showEmitter,
  onPick,
}: {
  findings: AmbiguityFinding[];
  showEmitter: boolean;
  onPick: (modeName: string) => void;
}) {
  const rows = useMemo(() => {
    const byId = new Map<string, Row>();
    for (const f of findings) {
      for (const [id, side] of [
        [f.mode_id_a, f.details.mode_a],
        [f.mode_id_b, f.details.mode_b],
      ] as const) {
        const row =
          byId.get(id) ??
          ({
            id,
            name: side.mode_name,
            emitter: side.emitter_name,
            counts: { exact_overlap: 0, high: 0, medium: 0, low: 0, none: 0 },
            open: 0,
            total: 0,
          } as Row);
        row.counts[f.combined_severity] += 1;
        row.total += 1;
        if (findingStatus(f) === "open") row.open += 1;
        byId.set(id, row);
      }
    }
    const weight = (r: Row) => [r.counts.exact_overlap, r.counts.high, r.counts.medium, r.counts.low];
    return [...byId.values()].sort((a, b) => {
      const wa = weight(a);
      const wb = weight(b);
      for (let i = 0; i < wa.length; i++) if (wa[i] !== wb[i]) return wb[i] - wa[i];
      return a.name.localeCompare(b.name);
    });
  }, [findings]);

  if (rows.length === 0) return <p className="hint-text">No findings match these filters.</p>;

  return (
    <table className="data-table modes-involved">
      <thead>
        <tr>
          <th>Mode</th>
          {SEVERITY_ORDER.map((s) => (
            <th key={s} className="num">
              <SeverityBadge severity={s} />
            </th>
          ))}
          <th className="num">Open</th>
          <th className="num">In findings</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} className="modes-involved-row" onClick={() => onPick(r.name)} title="Show its findings">
            <td>
              <button type="button" className="link-button">
                {r.name}
              </button>
              {showEmitter && <span className="hint-text"> · {r.emitter}</span>}
            </td>
            {SEVERITY_ORDER.map((s) => (
              <td key={s} className="num">
                {r.counts[s] || ""}
              </td>
            ))}
            <td className="num">{r.open}</td>
            <td className="num">{r.total}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
