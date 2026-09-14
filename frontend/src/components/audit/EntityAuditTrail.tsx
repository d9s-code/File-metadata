import { useState } from "react";
import type { AuditAction } from "../../types/domain";
import { useAuditActionCounts, useAuditLog } from "../../state/hooks/useAuditLog";
import { actionLabel } from "./auditFormat";
import { AuditLogList } from "./AuditLogList";

const PAGE_SIZE = 25;

export function EntityAuditTrail({
  entityType,
  entityId,
  emitterId,
}: {
  entityType: string;
  entityId: string;
  /** When set, rolls the trail up to everything under this Emitter (its own
   * entries plus its EW Groups/Sources/Modes/elements/generation
   * batches/imports/test records) instead of only exact entityType/entityId
   * matches — pass this from the Emitter Editor page only. */
  emitterId?: string;
}) {
  const [action, setAction] = useState<AuditAction | "">("");
  const [offset, setOffset] = useState(0);
  const rollup = !!emitterId;
  const { data: actionCounts } = useAuditActionCounts(
    rollup ? undefined : entityType,
    rollup ? undefined : entityId,
    emitterId,
  );
  const { data, isLoading } = useAuditLog({
    entity_type: rollup ? undefined : entityType,
    entity_id: rollup ? undefined : entityId,
    emitter_id: emitterId,
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
      {rollup && (
        <p className="hint-text">
          Includes this Emitter's own history plus its EW Groups, Sources, Modes, elements, generation
          batches, imports, and test records.
        </p>
      )}
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
          <AuditLogList entries={data?.items ?? []} showEntityType={rollup} />
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
