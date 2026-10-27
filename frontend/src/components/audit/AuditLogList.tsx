import { useState } from "react";
import { formatDateTime } from "../common/dates";
import type { AuditLogEntry } from "../../types/domain";
import { actionLabel, auditSummary, changeDigest, entityTypeSingular, formatChanges, versionMarker } from "./auditFormat";
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
      return compareStrings(entityTypeSingular(a.entity_type), entityTypeSingular(b.entity_type), dir);
  }
}

function ChangesToggle({ changes, entityType }: { changes: Record<string, unknown> | null; entityType: string }) {
  const [open, setOpen] = useState(false);
  const rows = formatChanges(changes, entityType);
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
  versionDividers = false,
}: {
  entries: AuditLogEntry[];
  /** Hide the Entity column when the list is already scoped to one entity type (e.g. a per-entity tab). */
  showEntityType?: boolean;
  /** Show the Emitter's version saves, reverts and discards as dividers, not rows. */
  versionDividers?: boolean;
}) {
  const { sorted, sortKey, sortDir, onSort, onClear } = useSortableTable(entries, compareEntries, "auditLog");

  if (entries.length === 0) {
    return <p className="hint-text">No audit entries match the current filters.</p>;
  }
  return (
    <>
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
        {sorted.map((e) => {
          const marker = versionDividers ? versionMarker(e) : null;
          if (marker)
            return (
              <tr key={e.id} className={`audit-version-row audit-version-${e.action}`}>
                <td>{formatDateTime(e.created_at)}</td>
                <td>{e.actor_username ?? <span className="hint-text">system</span>}</td>
                <td colSpan={showEntityType ? 4 : 3}>{marker}</td>
              </tr>
            );
          const digest = e.action === "update" ? changeDigest(e.changes) : null;
          return (
          <tr key={e.id}>
            <td>{formatDateTime(e.created_at)}</td>
            <td>{e.actor_username ?? <span className="hint-text">system</span>}</td>
            <td>
              <span className={`audit-action-badge audit-action-${e.action}`}>{actionLabel(e.action)}</span>
            </td>
            {showEntityType && <td>{entityTypeSingular(e.entity_type)}</td>}
            <td>
              {auditSummary(e.summary)}
              {digest && <div className="audit-digest">{digest}</div>}
            </td>
            <td>
              <ChangesToggle changes={e.changes} entityType={e.entity_type} />
            </td>
          </tr>
          );
        })}
      </tbody>
      </table>
    </>
  );
}
