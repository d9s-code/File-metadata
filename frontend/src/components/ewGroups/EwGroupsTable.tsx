import { useState } from "react";
import type { EwGroup } from "../../types/domain";
import { useDeleteEwGroup } from "../../state/hooks/useEwGroups";
import { useConfirmDialog } from "../common/ConfirmDialog";
import { EwGroupForm } from "./EwGroupForm";
import { RequireRole } from "../../auth/RequireAuth";

export function EwGroupsTable({ emitterId, ewGroups }: { emitterId: string; ewGroups: EwGroup[] }) {
  const deleteEwGroup = useDeleteEwGroup(emitterId);
  const { confirmDelete, dialog } = useConfirmDialog();
  const [showForm, setShowForm] = useState(false);

  async function handleDelete(group: EwGroup) {
    if (await confirmDelete(`Delete EW Group "${group.name}"? Its Modes will be deleted too.`)) {
      await deleteEwGroup.mutateAsync(group.id);
    }
  }

  return (
    <section className="card">
      <h4>EW Groups</h4>
      {ewGroups.length === 0 ? (
        <p className="hint-text">No EW Groups yet.</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Scan</th>
              <th>Threat priority</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {ewGroups.map((g) => (
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
