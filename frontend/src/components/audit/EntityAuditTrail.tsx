import { useState } from "react";
import type { AuditAction } from "../../types/domain";
import { useAuditActionCounts, useAuditLog } from "../../state/hooks/useAuditLog";
import { actionLabel } from "./auditFormat";
import { AuditLogList } from "./AuditLogList";

const PAGE_SIZE = 25;

export function EntityAuditTrail({ entityType, entityId }: { entityType: string; entityId: string }) {
  const [action, setAction] = useState<AuditAction | "">("");
  const [offset, setOffset] = useState(0);
  const { data: actionCounts } = useAuditActionCounts(entityType, entityId);
  const { data, isLoading } = useAuditLog({
    entity_type: entityType,
    entity_id: entityId,
    action: action || undefined,
    limit: PAGE_SIZE,
    offset,
  });

  function handleActionChange(value: string) {
    setAction(value as AuditAction | "");
    setOffset(0);
  }

  const total = data?.total ?? 0;
  const shown = offset + (data?.items.length ?? 0);

  return (
    <section className="card">
      <div className="modes-toolbar-row">
        <select value={action} onChange={(e) => handleActionChange(e.target.value)}>
          <option value="">All actions</option>
          {(actionCounts ?? [])
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
          <AuditLogList entries={data?.items ?? []} showEntityType={false} />
          {total > shown && (
            <button className="icon-button" onClick={() => setOffset(offset + PAGE_SIZE)}>
              Load more ({shown} of {total})
            </button>
          )}
        </>
      )}
    </section>
  );
}
