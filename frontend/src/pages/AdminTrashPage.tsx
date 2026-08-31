import { Link } from "react-router-dom";
import { useRestoreEntity, usePurgeForever, useTrash } from "../state/hooks/useTrash";
import { useConfirmDialog } from "../components/common/ConfirmDialog";
import { LoadingState } from "../components/common/LoadingState";
import { EmptyState } from "../components/common/EmptyState";
import { AdminNav } from "../components/common/AdminNav";
import { SortableColumnHeader } from "../components/common/SortableColumnHeader";
import { useSortableTable } from "../components/common/useSortableTable";
import { compareStrings } from "../components/common/sortUtils";
import type { DeletedItem, TrashEntityType } from "../api/trash";

const ENTITY_LABELS: Record<TrashEntityType, string> = { emitter: "Emitter", platform: "Platform", mdf: "MDF" };
const ENTITY_PATHS: Record<TrashEntityType, string> = { emitter: "/emitters", platform: "/platforms", mdf: "/mdfs" };

type TrashSortKey = "entity_type" | "name" | "deleted_at" | "expires_at";

function compareDeletedItems(a: DeletedItem, b: DeletedItem, key: TrashSortKey, dir: "asc" | "desc"): number {
  switch (key) {
    case "entity_type":
      return compareStrings(a.entity_type, b.entity_type, dir);
    case "name":
      return compareStrings(a.name, b.name, dir);
    case "deleted_at":
      return compareStrings(a.deleted_at, b.deleted_at, dir);
    case "expires_at":
      return compareStrings(a.expires_at, b.expires_at, dir);
  }
}

function daysRemaining(expiresAt: string): number {
  return Math.ceil((Date.parse(expiresAt) - Date.now()) / 86_400_000);
}

export function AdminTrashPage() {
  const { data: items, isLoading, error } = useTrash();
  const restoreEntity = useRestoreEntity();
  const purgeForever = usePurgeForever();
  const { confirmDelete, dialog } = useConfirmDialog();
  const { sorted, sortKey, sortDir, onSort, onClear } = useSortableTable(items ?? [], compareDeletedItems);

  async function handleRestore(item: DeletedItem) {
    // No confirm step here — restoring is safe and trivially reversible
    // (just delete it again), and useConfirmDialog's button is hardcoded
    // "Delete", which would be a misleading label for this action.
    await restoreEntity.mutateAsync({ entityType: item.entity_type, id: item.id });
  }

  async function handlePurge(item: DeletedItem) {
    if (
      await confirmDelete(
        `Permanently delete ${ENTITY_LABELS[item.entity_type]} "${item.name}"? This cannot be undone.`,
      )
    ) {
      await purgeForever.mutateAsync({ entityType: item.entity_type, id: item.id });
    }
  }

  return (
    <div className="page">
      <h1>Admin</h1>
      <AdminNav />
      <p className="hint-text">
        Deleted Emitters, Platforms, and MDFs stay here for 30 days before being purged automatically.
      </p>

      {error && <div className="error-text">{(error as Error).message}</div>}

      {isLoading ? (
        <LoadingState label="Loading trash…" />
      ) : (items ?? []).length === 0 ? (
        <EmptyState icon="✓" title="Nothing in the trash" message="Deleted Emitters, Platforms, and MDFs will show up here." />
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <SortableColumnHeader label="Type" columnKey="entity_type" activeKey={sortKey} activeDir={sortDir} onSort={onSort} onClear={onClear} />
              <SortableColumnHeader label="Name" columnKey="name" activeKey={sortKey} activeDir={sortDir} onSort={onSort} onClear={onClear} />
              <SortableColumnHeader label="Deleted" columnKey="deleted_at" columnType="date" activeKey={sortKey} activeDir={sortDir} onSort={onSort} onClear={onClear} />
              <SortableColumnHeader label="Days left" columnKey="expires_at" columnType="date" activeKey={sortKey} activeDir={sortDir} onSort={onSort} onClear={onClear} />
              <th></th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((item) => (
              <tr key={`${item.entity_type}-${item.id}`}>
                <td>{ENTITY_LABELS[item.entity_type]}</td>
                <td>
                  <Link to={`${ENTITY_PATHS[item.entity_type]}/${item.id}`}>{item.name}</Link>
                </td>
                <td>{new Date(item.deleted_at).toLocaleString()}</td>
                <td>{Math.max(daysRemaining(item.expires_at), 0)} day(s)</td>
                <td>
                  <button className="icon-button" onClick={() => void handleRestore(item)}>
                    Restore
                  </button>{" "}
                  <button className="link-button" onClick={() => void handlePurge(item)}>
                    Delete forever
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {dialog}
    </div>
  );
}
