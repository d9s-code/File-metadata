import { useState } from "react";
import type { AuditLogEntry } from "../../types/domain";
import { actionLabel, entityTypeLabel } from "./auditFormat";

function ChangesToggle({ changes }: { changes: Record<string, unknown> | null }) {
  const [open, setOpen] = useState(false);
  if (!changes || Object.keys(changes).length === 0) return <span className="hint-text">—</span>;
  return (
    <div>
      <button type="button" className="link-button" onClick={() => setOpen((v) => !v)}>
        {open ? "Hide" : "Details"}
      </button>
      {open && <pre className="audit-changes-pre">{JSON.stringify(changes, null, 2)}</pre>}
    </div>
  );
}

export function AuditLogList({
  entries,
  showEntityType = true,
}: {
  entries: AuditLogEntry[];
  /** Hide the Entity column when the list is already scoped to one entity type (e.g. a per-entity tab). */
  showEntityType?: boolean;
}) {
  if (entries.length === 0) {
    return <p className="hint-text">No audit entries match the current filters.</p>;
  }
  return (
    <table className="data-table">
      <thead>
        <tr>
          <th>When</th>
          <th>Actor</th>
          <th>Action</th>
          {showEntityType && <th>Entity</th>}
          <th>Summary</th>
          <th>Changes</th>
        </tr>
      </thead>
      <tbody>
        {entries.map((e) => (
          <tr key={e.id}>
            <td>{new Date(e.created_at).toLocaleString()}</td>
            <td>{e.actor_username ?? <span className="hint-text">system</span>}</td>
            <td>
              <span className={`audit-action-badge audit-action-${e.action}`}>{actionLabel(e.action)}</span>
            </td>
            {showEntityType && <td>{entityTypeLabel(e.entity_type)}</td>}
            <td>{e.summary}</td>
            <td>
              <ChangesToggle changes={e.changes} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
