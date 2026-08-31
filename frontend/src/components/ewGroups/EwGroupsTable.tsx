import { useState } from "react";
import type { EwGroup } from "../../types/domain";
import { useDeleteEwGroup } from "../../state/hooks/useEwGroups";
import { useConfirmDialog } from "../common/ConfirmDialog";
import { EwGroupForm } from "./EwGroupForm";
import { RequireRole } from "../../auth/RequireAuth";
import { EmptyState } from "../common/EmptyState";
import { SortableColumnHeader } from "../common/SortableColumnHeader";
import { useSortableTable } from "../common/useSortableTable";
import { compareNullable, compareStrings } from "../common/sortUtils";

type EwGroupSortKey = "name" | "scan" | "threat_priority";

function compareEwGroups(a: EwGroup, b: EwGroup, key: EwGroupSortKey, dir: "asc" | "desc"): number {
  switch (key) {
    case "name":
      return compareStrings(a.name, b.name, dir);
    case "scan":
      return compareNullable(a.scan_min, b.scan_min, dir);
    case "threat_priority":
      return compareNullable(a.threat_priority, b.threat_priority, dir);
  }
}

export function EwGroupsTable({ emitterId, ewGroups }: { emitterId: string; ewGroups: EwGroup[] }) {
  const deleteEwGroup = useDeleteEwGroup(emitterId);
  const { confirmDelete, dialog } = useConfirmDialog();
  const [showForm, setShowForm] = useState(false);
  const { sorted, sortKey, sortDir, onSort, onClear } = useSortableTable(ewGroups, compareEwGroups);

  async function handleDelete(group: EwGroup) {
    if (await confirmDelete(`Delete EW Group "${group.name}"? Its Modes will be deleted too.`)) {
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
                <td>
                  <RequireRole minimum="editor">
                    <button className="link-button" onClick={() => void handleDelete(g)}>
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
        {showForm ? (
          <EwGroupForm emitterId={emitterId} />
        ) : (
          <button className="icon-button" onClick={() => setShowForm(true)}>
            + Add EW Group
          </button>
        )}
      </RequireRole>
      {dialog}
    </section>
  );
}
