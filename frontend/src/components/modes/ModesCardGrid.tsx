import type { EwGroup, Mode, Source } from "../../types/domain";
import { formatPri } from "./modeFormat";
import { RequireRole } from "../../auth/RequireAuth";

export function ModesCardGrid({
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
    <div className="mode-card-grid">
      {modes.map((m) => (
        <div key={m.id} className="mode-card">
          <div className="mode-card-header">
            <strong>{m.name}</strong>
            <RequireRole minimum="editor">
              <button className="link-button" onClick={() => onDelete(m.id, m.ew_group_id, m.name)}>
                Delete
              </button>
            </RequireRole>
          </div>
          <div className="mode-card-badges">
            <span className="status-badge">{ewGroupsById[m.ew_group_id]?.name ?? "—"}</span>
            <span className="status-badge">{sourcesById[m.source_id]?.name ?? "—"}</span>
          </div>
          <dl className="mode-card-fields">
            <div>
              <dt>RF (MHz)</dt>
              <dd>{m.line ? `${m.line.rf_min_mhz}–${m.line.rf_max_mhz}` : "—"}</dd>
            </div>
            <div>
              <dt>PW (µs)</dt>
              <dd>{m.line ? `${m.line.pw_min_us}–${m.line.pw_max_us}` : "—"}</dd>
            </div>
            <div>
              <dt>PRI Type</dt>
              <dd>{m.pri_type.toUpperCase()}</dd>
            </div>
            <div>
              <dt>PRI</dt>
              <dd>{formatPri(m)}</dd>
            </div>
          </dl>
        </div>
      ))}
    </div>
  );
}
