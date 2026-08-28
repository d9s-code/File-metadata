import { useState } from "react";
import type { AuditAction } from "../types/domain";
import { useAuditActionCounts, useAuditEntityTypeCounts, useAuditLog } from "../state/hooks/useAuditLog";
import { actionLabel, entityTypeLabel } from "../components/audit/auditFormat";
import { AuditLogList } from "../components/audit/AuditLogList";

const PAGE_SIZE = 50;

export function AuditLogPage() {
  const [entityType, setEntityType] = useState<string | null>(null);
  const [action, setAction] = useState<AuditAction | "">("");
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);

  const { data: groups } = useAuditEntityTypeCounts();
  const { data: actions } = useAuditActionCounts(entityType ?? undefined);
  const { data, isLoading } = useAuditLog({
    entity_type: entityType ?? undefined,
    action: action || undefined,
    q: search.trim() || undefined,
    limit: PAGE_SIZE,
    offset,
  });

  function selectGroup(type: string | null) {
    setEntityType(type);
    setAction("");
    setOffset(0);
  }

  function selectAction(value: string) {
    setAction(value as AuditAction | "");
    setOffset(0);
  }

  const total = data?.total ?? 0;
  const shown = offset + (data?.items.length ?? 0);
  const allCount = (groups ?? []).reduce((sum, g) => sum + g.count, 0);

  return (
    <div className="page audit-log-page">
      <h1>Audit Log</h1>
      <p className="hint-text">
        A chronological record of who changed what, when — across the whole app. Navigate by entity type
        (group) and then by action (subgroup), or search freely below.
      </p>

      <div className="audit-log-layout">
        <nav className="audit-log-groups">
          <button
            className={entityType === null ? "audit-group-item active" : "audit-group-item"}
            onClick={() => selectGroup(null)}
          >
            All entities <span className="audit-group-count">{allCount}</span>
          </button>
          {(groups ?? [])
            .filter((g) => g.count > 0)
            .map((g) => (
              <button
                key={g.entity_type}
                className={entityType === g.entity_type ? "audit-group-item active" : "audit-group-item"}
                onClick={() => selectGroup(g.entity_type)}
              >
                {entityTypeLabel(g.entity_type)} <span className="audit-group-count">{g.count}</span>
              </button>
            ))}
        </nav>

        <div className="audit-log-content">
          <div className="modes-toolbar-row">
            <input
              type="text"
              placeholder="Search summaries…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setOffset(0);
              }}
            />
            <select value={action} onChange={(e) => selectAction(e.target.value)}>
              <option value="">All actions</option>
              {(actions ?? [])
                .filter((a) => a.count > 0)
                .map((a) => (
                  <option key={a.action} value={a.action}>
                    {actionLabel(a.action)} ({a.count})
                  </option>
                ))}
            </select>
          </div>

          {isLoading ? (
            <p className="page-loading">Loading…</p>
          ) : (
            <>
              <AuditLogList entries={data?.items ?? []} showEntityType={entityType === null} />
              {total > shown && (
                <button className="icon-button" onClick={() => setOffset(offset + PAGE_SIZE)}>
                  Load more ({shown} of {total})
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
