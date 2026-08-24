import type { AmbiguityFinding, AmbiguitySeverity } from "../../api/ambiguity";

interface MatrixMode {
  id: string;
  label: string;
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
  if (findings.length === 0) return null;

  const modesById = new Map<string, MatrixMode>();
  const severityByPair = new Map<string, { severity: AmbiguitySeverity; findingId: string }>();

  for (const f of findings) {
    modesById.set(f.mode_id_a, { id: f.mode_id_a, label: `${f.details.mode_a.mode_name} (${f.details.mode_a.emitter_name})` });
    modesById.set(f.mode_id_b, { id: f.mode_id_b, label: `${f.details.mode_b.mode_name} (${f.details.mode_b.emitter_name})` });
    const key = [f.mode_id_a, f.mode_id_b].sort().join("|");
    severityByPair.set(key, { severity: f.combined_severity, findingId: f.id });
  }

  const modes = [...modesById.values()].sort((a, b) => a.label.localeCompare(b.label));

  return (
    <div className="matrix-scroll">
      <table className="ambiguity-matrix">
        <thead>
          <tr>
            <th></th>
            {modes.map((m) => (
              <th key={m.id} title={m.label}>
                {m.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {modes.map((rowMode) => (
            <tr key={rowMode.id}>
              <th title={rowMode.label}>{rowMode.label}</th>
              {modes.map((colMode) => {
                if (rowMode.id === colMode.id) return <td key={colMode.id} className="matrix-cell matrix-diagonal" />;
                const key = [rowMode.id, colMode.id].sort().join("|");
                const cell = severityByPair.get(key);
                if (!cell) return <td key={colMode.id} className="matrix-cell matrix-empty" />;
                return (
                  <td
                    key={colMode.id}
                    className={`matrix-cell severity-${cell.severity} ${cell.findingId === selectedId ? "matrix-selected" : ""}`}
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
  );
}
