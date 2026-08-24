import type { Mode, Source } from "../../types/domain";
import { useDeleteMode } from "../../state/hooks/useModes";
import { RequireRole } from "../../auth/RequireAuth";

function formatPri(mode: Mode): string {
  const line = mode.line;
  if (!line) return "—";
  switch (mode.pri_type) {
    case "fixed":
      return `${line.pri_min_us}–${line.pri_max_us} µs (jitter ${line.jitter_min_us}–${line.jitter_max_us})`;
    case "stagger":
      return `[${(line.pri_stagger_values_us ?? []).join(", ")}] µs`;
    case "cw":
      return "CW (constant)";
    case "xlet":
      return "—";
  }
}

export function ModeLinesTable({
  ewGroupId,
  modes,
  sourcesById,
}: {
  ewGroupId: string;
  modes: Mode[];
  sourcesById: Record<string, Source>;
}) {
  const deleteMode = useDeleteMode(ewGroupId);

  if (modes.length === 0) return <p className="hint-text">No modes yet.</p>;

  return (
    <table className="data-table">
      <thead>
        <tr>
          <th>Name</th>
          <th>Source</th>
          <th>RF (MHz)</th>
          <th>PW (µs)</th>
          <th>PRI Type</th>
          <th>PRI</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {modes.map((m) => (
          <tr key={m.id}>
            <td>{m.name}</td>
            <td>{sourcesById[m.source_id]?.name ?? "—"}</td>
            <td>
              {m.line ? `${m.line.rf_min_mhz}–${m.line.rf_max_mhz}` : "—"}
            </td>
            <td>{m.line ? `${m.line.pw_min_us}–${m.line.pw_max_us}` : "—"}</td>
            <td>{m.pri_type.toUpperCase()}</td>
            <td>{formatPri(m)}</td>
            <td>
              <RequireRole minimum="editor">
                <button className="link-button" onClick={() => void deleteMode.mutateAsync(m.id)}>
                  Delete
                </button>
              </RequireRole>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
