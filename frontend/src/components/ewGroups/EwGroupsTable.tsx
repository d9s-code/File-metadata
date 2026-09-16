import { useState } from "react";
import type { EwGroup } from "../../types/domain";
import { useDeleteEwGroup } from "../../state/hooks/useEwGroups";
import { useEmitter } from "../../state/hooks/useEmitters";
import { useEmitterCheckoutState } from "../../state/hooks/useEmitterCheckout";
import { useConfirmDialog } from "../common/ConfirmDialog";
import { EwGroupForm } from "./EwGroupForm";
import { RequireRole } from "../../auth/RequireAuth";
import { EmptyState } from "../common/EmptyState";
import { SortableColumnHeader } from "../common/SortableColumnHeader";
import { useSortableTable } from "../common/useSortableTable";
import { compareNullable, compareStrings } from "../common/sortUtils";

type EwGroupSortKey = "name" | "scan" | "threat_priority" | "ageout";

function compareEwGroups(a: EwGroup, b: EwGroup, key: EwGroupSortKey, dir: "asc" | "desc"): number {
  switch (key) {
    case "name":
      return compareStrings(a.name, b.name, dir);
    case "scan":
      return compareNullable(a.scan_min, b.scan_min, dir);
    case "threat_priority":
      return compareNullable(a.threat_priority, b.threat_priority, dir);
    case "ageout":
      return compareNullable(a.ageout, b.ageout, dir);
  }
}

export function EwGroupsTable({ emitterId, ewGroups }: { emitterId: string; ewGroups: EwGroup[] }) {
  const deleteEwGroup = useDeleteEwGroup(emitterId);
  const { confirmDelete, dialog } = useConfirmDialog();
  const [showForm, setShowForm] = useState(false);
  const [editingGroup, setEditingGroup] = useState<EwGroup | null>(null);
  const { sorted, sortKey, sortDir, onSort, onClear } = useSortableTable(ewGroups, compareEwGroups);
  const { data: emitter } = useEmitter(emitterId);
  const { canEdit } = useEmitterCheckoutState(emitter);
  const editTitle = canEdit ? undefined : "Start editing this Emitter first";

  async function handleDelete(group: EwGroup) {
    const modesCount = group.modes_count;
    const message = modesCount > 0 
      ? `Warning: This will also delete all ${modesCount} Modes associated with this group. This action cannot be undone. Delete EW Group "${group.name}"?`
      : `Delete EW Group "${group.name}"?`;

    if (await confirmDelete(message)) {
      await deleteEwGroup.mutateAsync(group.id);
    }
  }

  return (
    <section className="card">
      <h4>EW Groups</h4>
      {ewGroups.length === 0 ? (
        <EmptyState
          icon="◇"
          title="No EW Groups yet"
          message="An EW Group is an operational bucket (scan range + threat priority) that Modes are organized under."
        />
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <SortableColumnHeader label="Name" columnKey="name" activeKey={sortKey} activeDir={sortDir} onSort={onSort} onClear={onClear} />
              <SortableColumnHeader
                label="Scan"
                columnKey="scan"
                columnType="number"
                activeKey={sortKey}
                activeDir={sortDir}
                onSort={onSort}
                onClear={onClear}
              />
              <SortableColumnHeader
                label="Threat priority"
                columnKey="threat_priority"
                columnType="number"
                activeKey={sortKey}
                activeDir={sortDir}
                onSort={onSort}
                onClear={onClear}
              />
              <SortableColumnHeader
                label="Ageout (s)"
                columnKey="ageout"
                columnType="number"
                activeKey={sortKey}
                activeDir={sortDir}
                onSort={onSort}
                onClear={onClear}
              />
              <th></th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((g) => (
              <tr key={g.id}>
                <td>{g.name}</td>
                <td>
                  {g.scan_min ?? "—"}–{g.scan_max ?? "—"}
                  {g.scan_delta != null && (
                    <span className="hint-text">
                      {" "}
                      · engineered: {g.engineered_scan_min}–{g.engineered_scan_max} (±{g.scan_delta})
                    </span>
                  )}
                </td>
                <td>{g.threat_priority ?? "—"}</td>
                <td>{g.ageout ?? "—"}</td>
                <td>
                  <RequireRole minimum="editor">
                    <button className="link-button" disabled={!canEdit} title={editTitle} onClick={() => setEditingGroup(g)}>
                      Edit
                    </button>
                    <button className="link-button" disabled={!canEdit} title={editTitle} onClick={() => void handleDelete(g)}>
                      Delete
                    </button>
                  </RequireRole>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <RequireRole minimum="editor">
        {editingGroup ? (
          <EwGroupForm 
            emitterId={emitterId} 
            initialData={editingGroup} 
            onClose={() => setEditingGroup(null)} 
          />
        ) : showForm ? (
          <EwGroupForm emitterId={emitterId} onClose={() => setShowForm(false)} />
        ) : (
          <button className="icon-button" disabled={!canEdit} title={editTitle} onClick={() => setShowForm(true)}>
            + Add EW Group
          </button>
        )}
      </RequireRole>
      {dialog}
    </section>
  );
}
