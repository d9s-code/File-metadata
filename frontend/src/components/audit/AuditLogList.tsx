import { useState } from "react";
import type { AuditLogEntry } from "../../types/domain";
import { actionLabel, entityTypeLabel, formatChanges } from "./auditFormat";
import { SortableColumnHeader } from "../common/SortableColumnHeader";
import { useSortableTable } from "../common/useSortableTable";
import { compareStrings } from "../common/sortUtils";

type AuditSortKey = "when" | "actor" | "action" | "entity";

function compareEntries(a: AuditLogEntry, b: AuditLogEntry, key: AuditSortKey, dir: "asc" | "desc"): number {
  switch (key) {
    case "when":
      return compareStrings(a.created_at, b.created_at, dir);
    case "actor":
      return compareStrings(a.actor_username, b.actor_username, dir);
    case "action":
      return compareStrings(actionLabel(a.action), actionLabel(b.action), dir);
    case "entity":
      return compareStrings(entityTypeLabel(a.entity_type), entityTypeLabel(b.entity_type), dir);
  }
}

function ChangesToggle({ changes }: { changes: Record<string, unknown> | null }) {
  const [open, setOpen] = useState(false);
  const rows = formatChanges(changes);
  if (rows.length === 0) return <span className="hint-text">—</span>;
  return (
    <div>
      <button type="button" className="link-button" onClick={() => setOpen((v) => !v)}>
        {open ? "Hide" : `Details (${rows.length})`}
      </button>
      {open && (
        <div className="audit-diff-list">
          {rows.map((row) => (
            <div key={row.field} className="audit-diff-row">
              <span className="audit-diff-label">{row.label}:</span>
              {row.hasOld ? (
                <>
                  <span className="audit-diff-old">{row.oldDisplay}</span>
                  <span className="audit-diff-arrow">→</span>
                  <span className="audit-diff-new">{row.newDisplay}</span>
                </>
              ) : (
                <span className="audit-diff-new">{row.newDisplay}</span>
              )}
            </div>
          ))}
        </div>
      )}
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
  const { sorted, sortKey, sortDir, onSort, onClear } = useSortableTable(entries, compareEntries);

  if (entries.length === 0) {
    return <p className="hint-text">No audit entries match the current filters.</p>;
  }
  return (
    <>
      <p className="hint-text" title="Sorting only reorders the rows currently loaded on this page — use the filters above to narrow results across the full log.">
        Sorting applies to the entries currently loaded below, not the full log.
      </p>
      <table className="data-table">
      <thead>
        <tr>
          <SortableColumnHeader
            label="When"
            columnKey="when"
            columnType="date"
            activeKey={sortKey}
            activeDir={sortDir}
            onSort={onSort}
            onClear={onClear}
          />
          <SortableColumnHeader label="Actor" columnKey="actor" activeKey={sortKey} activeDir={sortDir} onSort={onSort} onClear={onClear} />
          <SortableColumnHeader label="Action" columnKey="action" activeKey={sortKey} activeDir={sortDir} onSort={onSort} onClear={onClear} />
          {showEntityType && (
            <SortableColumnHeader
              label="Entity"
              columnKey="entity"
              activeKey={sortKey}
              activeDir={sortDir}
              onSort={onSort}
              onClear={onClear}
            />
          )}
          <th>Summary</th>
          <th>Changes</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((e) => (
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
    </>
  );
}
