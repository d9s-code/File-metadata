import { useState } from "react";
import { RenameDialog } from "../common/RenameDialog";
import { MenuButton } from "../common/MenuButton";
import type { EwGroup } from "../../types/domain";
import { useDeleteEwGroup, useEwGroupSuggestion, useUpdateEwGroup } from "../../state/hooks/useEwGroups";
import type { EwGroupSuggestion } from "../../api/ewGroups";
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
  const { data: suggestion } = useEwGroupSuggestion(emitterId, ewGroups.length === 0);
  const [prefill, setPrefill] = useState<EwGroupSuggestion | null>(null);
  const [editingGroup, setEditingGroup] = useState<EwGroup | null>(null);
  const [renamingGroup, setRenamingGroup] = useState<EwGroup | null>(null);
  const updateEwGroup = useUpdateEwGroup(emitterId);
  const { sorted, sortKey, sortDir, onSort, onClear } = useSortableTable(ewGroups, compareEwGroups, "ewGroups");
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
      <div className="card-header">
        <h4>EW Groups</h4>
        <RequireRole minimum="editor">
          <button
            className="button secondary small"
            disabled={!canEdit || showForm || !!editingGroup}
            title={editTitle}
            onClick={() => setShowForm(true)}
          >
            + Add EW Group
          </button>
        </RequireRole>
      </div>
      {ewGroups.length === 0 ? (
        <>
          <EmptyState
            compact
            icon="◇"
            title="No EW Groups yet"
            message="An EW Group is an operational bucket (scan range + threat priority) that Modes are organized under."
          />
          {suggestion && !showForm && (
            <div className="ew-group-suggestion">
              <span>
                <strong>Suggested:</strong> scan {suggestion.scan_min}–{suggestion.scan_max} s
              </span>
              <span className="hint-text" title={suggestion.source_names.join("\n")}>
                the shortest and longest scan time in {suggestion.element_count} scan Element
                {suggestion.element_count === 1 ? "" : "s"} of {suggestion.source_names.length === 1
                  ? suggestion.source_names[0]
                  : `${suggestion.source_names.length} Sources`}
              </span>
              <RequireRole minimum="editor">
                <button
                  type="button"
                  className="button secondary small"
                  disabled={!canEdit}
                  title={editTitle}
                  onClick={() => {
                    setPrefill(suggestion);
                    setShowForm(true);
                  }}
                >
                  Use it for a new EW Group
                </button>
              </RequireRole>
            </div>
          )}
        </>
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
              <th className="row-actions" aria-label="Actions"></th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((g) => (
              <tr key={g.id}>
                <td>{g.name}</td>
                <td>
                  {g.scan_min == null && g.scan_max == null ? "—" : `${g.scan_min ?? "?"}–${g.scan_max ?? "?"}`}
                  {g.scan_delta != null && (
                    <span className="hint-text">
                      {" "}
                      · engineered: {g.engineered_scan_min}–{g.engineered_scan_max} (±{g.scan_delta})
                    </span>
                  )}
                </td>
                <td>{g.threat_priority ?? "—"}</td>
                <td>{g.ageout ?? "—"}</td>
                <td className="row-actions">
                  <RequireRole minimum="editor">
                    <MenuButton
                      label="⋯"
                      className="row-menu-button"
                      ariaLabel={`Actions for ${g.name}`}
                      items={[
                        { label: "Rename…", disabled: !canEdit, title: editTitle, onSelect: () => setRenamingGroup(g) },
                        { label: "Edit", disabled: !canEdit, title: editTitle, onSelect: () => setEditingGroup(g) },
                        { label: "Delete…", danger: true, disabled: !canEdit, title: editTitle, onSelect: () => void handleDelete(g) },
                      ]}
                    />
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
          <EwGroupForm
            emitterId={emitterId}
            prefill={prefill}
            onClose={() => {
              setShowForm(false);
              setPrefill(null);
            }}
          />
        ) : null}
      </RequireRole>
      {dialog}
      {renamingGroup && (
        <RenameDialog
          what="EW Group"
          currentName={renamingGroup.name}
          takenNames={ewGroups.filter((x) => x.id !== renamingGroup.id).map((x) => x.name)}
          takenWhere="on this Emitter"
          onRename={(name) => updateEwGroup.mutateAsync({ ewGroupId: renamingGroup.id, input: { name } })}
          onClose={() => setRenamingGroup(null)}
        />
      )}
    </section>
  );
}
