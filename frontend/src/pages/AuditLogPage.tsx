import { useState } from "react";
import type { AuditAction, AuditEntitySearchResult } from "../types/domain";
import {
  useAuditActionCounts,
  useAuditEntitySearch,
  useAuditEntityTypeCounts,
  useAuditLog,
} from "../state/hooks/useAuditLog";
import { actionLabel, entityTypeLabel } from "../components/audit/auditFormat";
import { AuditLogList } from "../components/audit/AuditLogList";

const PAGE_SIZE = 50;

export function AuditLogPage() {
  const [entityType, setEntityType] = useState<string | null>(null);
  const [action, setAction] = useState<AuditAction | "">("");
  const [search, setSearch] = useState("");
  const [selectedEntity, setSelectedEntity] = useState<AuditEntitySearchResult | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [offset, setOffset] = useState(0);

  const { data: groups } = useAuditEntityTypeCounts();
  const { data: actions } = useAuditActionCounts(entityType ?? undefined);
  const { data: entityMatches } = useAuditEntitySearch(selectedEntity ? "" : search);
  const { data, isLoading } = useAuditLog({
    entity_type: selectedEntity ? selectedEntity.entity_type : (entityType ?? undefined),
    entity_id: selectedEntity?.entity_id,
    action: action || undefined,
    q: selectedEntity ? undefined : search.trim() || undefined,
    since: dateFrom || undefined,
    until: dateTo ? `${dateTo}T23:59:59` : undefined,
    limit: PAGE_SIZE,
    offset,
  });

  function selectGroup(type: string | null) {
    setEntityType(type);
    setAction("");
    setSelectedEntity(null);
    setOffset(0);
  }

  function selectAction(value: string) {
    setAction(value as AuditAction | "");
    setOffset(0);
  }

  function pickEntity(result: AuditEntitySearchResult) {
    setSelectedEntity(result);
    setSearch("");
    setPickerOpen(false);
    setOffset(0);
  }

  function clearEntity() {
    setSelectedEntity(null);
    setOffset(0);
  }

  function changeDateFrom(value: string) {
    setDateFrom(value);
    setOffset(0);
  }

  function changeDateTo(value: string) {
    setDateTo(value);
    setOffset(0);
  }

  function clearDates() {
    setDateFrom("");
    setDateTo("");
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
        (group) and then by action (subgroup), search an object by name (an Emitter, Platform, MDF, EW
        Group, or Source), or search freely over summaries below.
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
            {selectedEntity ? (
              <span className="audit-entity-chip">
                Scoped to: <strong>{selectedEntity.name}</strong>{" "}
                <span className="muted">({entityTypeLabel(selectedEntity.entity_type)})</span>
                <button type="button" className="link-button" onClick={clearEntity}>
                  ✕
                </button>
              </span>
            ) : (
              <div className="audit-entity-search">
                <input
                  type="text"
                  placeholder="Search by name (Emitter, Platform, MDF, EW Group, Source) or free text…"
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setPickerOpen(true);
                    setOffset(0);
                  }}
                  onFocus={() => setPickerOpen(true)}
                  onBlur={() => setTimeout(() => setPickerOpen(false), 150)}
                />
                {pickerOpen && (entityMatches ?? []).length > 0 && (
                  <ul className="audit-entity-picker">
                    {(entityMatches ?? []).map((m) => (
                      <li key={`${m.entity_type}:${m.entity_id}`}>
                        <button type="button" onMouseDown={() => pickEntity(m)}>
                          <span>{m.name}</span>
                          <span className="audit-entity-picker-type">{entityTypeLabel(m.entity_type)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
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
            <label className="inline-date-filter">
              From
              <input type="date" value={dateFrom} onChange={(e) => changeDateFrom(e.target.value)} />
            </label>
            <label className="inline-date-filter">
              To
              <input type="date" value={dateTo} onChange={(e) => changeDateTo(e.target.value)} />
            </label>
            {(dateFrom || dateTo) && (
              <button type="button" className="link-button" onClick={clearDates}>
                Clear dates
              </button>
            )}
          </div>

          {isLoading ? (
            <p className="page-loading">Loading…</p>
          ) : (
            <>
              <AuditLogList entries={data?.items ?? []} showEntityType={entityType === null && !selectedEntity} />
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
