import { useState } from "react";
import type { FunctionGroup } from "../../types/domain";
import { useDeleteFunctionGroup } from "../../state/hooks/useFunctionGroups";
import { useEmitter } from "../../state/hooks/useEmitters";
import { useEmitterCheckoutState } from "../../state/hooks/useEmitterCheckout";
import { useConfirmDialog } from "../common/ConfirmDialog";
import { FunctionGroupForm } from "./FunctionGroupForm";
import { RequireRole } from "../../auth/RequireAuth";
import { EmptyState } from "../common/EmptyState";
import { SortableColumnHeader } from "../common/SortableColumnHeader";
import { useSortableTable } from "../common/useSortableTable";
import { compareStrings } from "../common/sortUtils";

type FunctionGroupSortKey = "name";

function compareFunctionGroups(a: FunctionGroup, b: FunctionGroup, key: FunctionGroupSortKey, dir: "asc" | "desc"): number {
  switch (key) {
    case "name":
      return compareStrings(a.name, b.name, dir);
  }
}

export function FunctionGroupsTable({ emitterId, functionGroups }: { emitterId: string; functionGroups: FunctionGroup[] }) {
  const deleteFunctionGroup = useDeleteFunctionGroup(emitterId);
  const { confirmDelete, dialog } = useConfirmDialog();
  const [showForm, setShowForm] = useState(false);
  const [editingGroup, setEditingGroup] = useState<FunctionGroup | null>(null);
  const { sorted, sortKey, sortDir, onSort, onClear } = useSortableTable(functionGroups, compareFunctionGroups);
  const { data: emitter } = useEmitter(emitterId);
  const { canEdit } = useEmitterCheckoutState(emitter);
  const editTitle = canEdit ? undefined : "Start editing this Emitter first";

  async function handleDelete(group: FunctionGroup) {
    const modesCount = group.modes_count;
    const message =
      modesCount > 0
        ? `${modesCount} Mode(s) are assigned to this Function Group — they'll just become unassigned, not deleted. Delete Function Group "${group.name}"?`
        : `Delete Function Group "${group.name}"?`;

    if (await confirmDelete(message)) {
      await deleteFunctionGroup.mutateAsync(group.id);
    }
  }

  return (
    <section className="card">
      <h4>Function Groups</h4>
      {functionGroups.length === 0 ? (
        <EmptyState
          icon="◈"
          title="No Function Groups yet"
          message="A Function Group organizes Modes by what they do (e.g. Search, Track, Guidance) — independent of EW Group, and used to structure testing."
        />
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <SortableColumnHeader label="Name" columnKey="name" activeKey={sortKey} activeDir={sortDir} onSort={onSort} onClear={onClear} />
              <th>Modes</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((g) => (
              <tr key={g.id}>
                <td>{g.name}</td>
                <td>{g.modes_count}</td>
                <td>
                  <RequireRole minimum="editor">
                    <button className="link-button" disabled={!canEdit} title={editTitle} onClick={() => setEditingGroup(g)}>
                      Edit
                    </button>
                    <button className="link-button link-button-danger" disabled={!canEdit} title={editTitle} onClick={() => void handleDelete(g)}>
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
          <FunctionGroupForm emitterId={emitterId} initialData={editingGroup} onClose={() => setEditingGroup(null)} />
        ) : showForm ? (
          <FunctionGroupForm emitterId={emitterId} onClose={() => setShowForm(false)} />
        ) : (
          <button className="icon-button" disabled={!canEdit} title={editTitle} onClick={() => setShowForm(true)}>
            + Add Function Group
          </button>
        )}
      </RequireRole>
      {dialog}
    </section>
  );
}
