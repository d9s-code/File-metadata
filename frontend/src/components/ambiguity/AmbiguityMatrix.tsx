import { useState } from "react";
import type { AmbiguityFinding, AmbiguitySeverity } from "../../api/ambiguity";

type ClusterBy = "none" | "ewGroup" | "source";

interface MatrixMode {
  id: string;
  label: string;
  groupKey: string;
}

export function AmbiguityMatrix({
  findings,
  selectedId,
  onSelectFinding,
}: {
  findings: AmbiguityFinding[];
  selectedId: string | null;
  onSelectFinding: (findingId: string) => void;
}) {
  const [clusterBy, setClusterBy] = useState<ClusterBy>("none");

  if (findings.length === 0) return null;

  const modesById = new Map<string, MatrixMode>();
  const severityByPair = new Map<string, { severity: AmbiguitySeverity; findingId: string }>();

  function groupKeyFor(side: AmbiguityFinding["details"]["mode_a"]): string {
    if (clusterBy === "ewGroup") return side.ew_group_name;
    if (clusterBy === "source") return side.source_name;
    return "";
  }

  for (const f of findings) {
    modesById.set(f.mode_id_a, {
      id: f.mode_id_a,
      label: `${f.details.mode_a.mode_name} (${f.details.mode_a.emitter_name})`,
      groupKey: groupKeyFor(f.details.mode_a),
    });
    modesById.set(f.mode_id_b, {
      id: f.mode_id_b,
      label: `${f.details.mode_b.mode_name} (${f.details.mode_b.emitter_name})`,
      groupKey: groupKeyFor(f.details.mode_b),
    });
    const key = [f.mode_id_a, f.mode_id_b].sort().join("|");
    severityByPair.set(key, { severity: f.combined_severity, findingId: f.id });
  }

  const modes = [...modesById.values()].sort((a, b) => {
    if (clusterBy !== "none" && a.groupKey !== b.groupKey) return a.groupKey.localeCompare(b.groupKey);
    return a.label.localeCompare(b.label);
  });

  function groupBoundary(index: number): boolean {
    if (clusterBy === "none" || index === 0) return false;
    return modes[index].groupKey !== modes[index - 1].groupKey;
  }

  return (
    <div>
      <div className="form-row matrix-cluster-row">
        <label className="inline-date-label">
          Cluster by
          <select value={clusterBy} onChange={(e) => setClusterBy(e.target.value as ClusterBy)}>
            <option value="none">None</option>
            <option value="ewGroup">EW Group</option>
            <option value="source">Source</option>
          </select>
        </label>
      </div>
      <div className="matrix-scroll">
        <table className="ambiguity-matrix">
          <thead>
            <tr>
              <th></th>
              {modes.map((m, i) => (
                <th key={m.id} title={m.label} className={groupBoundary(i) ? "matrix-group-boundary" : ""}>
                  {m.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {modes.map((rowMode, i) => (
              <tr key={rowMode.id} className={groupBoundary(i) ? "matrix-group-boundary" : ""}>
                <th title={rowMode.label}>{rowMode.label}</th>
                {modes.map((colMode, j) => {
                  const cellClass = groupBoundary(j) ? "matrix-group-boundary" : "";
                  if (rowMode.id === colMode.id)
                    return <td key={colMode.id} className={`matrix-cell matrix-diagonal ${cellClass}`} />;
                  const key = [rowMode.id, colMode.id].sort().join("|");
                  const cell = severityByPair.get(key);
                  if (!cell) return <td key={colMode.id} className={`matrix-cell matrix-empty ${cellClass}`} />;
                  return (
                    <td
                      key={colMode.id}
                      className={`matrix-cell severity-${cell.severity} ${cellClass} ${cell.findingId === selectedId ? "matrix-selected" : ""}`}
                      onClick={() => onSelectFinding(cell.findingId)}
                      title={cell.severity.replace("_", " ")}
                    />
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
