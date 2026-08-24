import type { EwGroup, Mode, Source } from "../../types/domain";
import { formatPri } from "./modeFormat";
import { RequireRole } from "../../auth/RequireAuth";

export function ModesTable({
  modes,
  ewGroupsById,
  sourcesById,
  onDelete,
}: {
  modes: Mode[];
  ewGroupsById: Record<string, EwGroup>;
  sourcesById: Record<string, Source>;
  onDelete: (modeId: string, ewGroupId: string, name: string) => void;
}) {
  return (
    <table className="data-table">
      <thead>
        <tr>
          <th>Name</th>
          <th>EW Group</th>
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
            <td>{ewGroupsById[m.ew_group_id]?.name ?? "—"}</td>
            <td>{sourcesById[m.source_id]?.name ?? "—"}</td>
            <td>{m.line ? `${m.line.rf_min_mhz}–${m.line.rf_max_mhz}` : "—"}</td>
            <td>{m.line ? `${m.line.pw_min_us}–${m.line.pw_max_us}` : "—"}</td>
            <td>{m.pri_type.toUpperCase()}</td>
            <td>{formatPri(m)}</td>
            <td>
              <RequireRole minimum="editor">
                <button className="link-button" onClick={() => onDelete(m.id, m.ew_group_id, m.name)}>
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
