import { useState, type FormEvent } from "react";
import { useSourceGroups } from "../state/hooks/useSourceGroups";
import { SourceGroupForm } from "../components/sources/SourceGroupForm";
import { RequireRole } from "../auth/RequireAuth";
import { LoadingState } from "../components/common/LoadingState";
import { EmptyState } from "../components/common/EmptyState";
import { useConfirmDialog } from "../components/common/ConfirmDialog";
import { ApiRequestError } from "../api/client";
import type { SourceGroup } from "../types/domain";

function rangeText(min: number | null, max: number | null, unit: string): string {
  if (min == null || max == null) return "—";
  return `${min}–${max} ${unit}`;
}

function EditGroupRow({ group, onDone }: { group: SourceGroup; onDone: () => void }) {
  const { updateGroup, isUpdating } = useSourceGroups();
  const [name, setName] = useState(group.name);
  const [description, setDescription] = useState(group.description ?? "");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await updateGroup({ id: group.id, input: { name, description } });
      onDone();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Failed to update Source Group");
    }
  }

  return (
    <tr>
      <td colSpan={7}>
        <form className="inline-form" onSubmit={handleSubmit}>
          <input value={name} onChange={(e) => setName(e.target.value)} required />
          <input
            placeholder="Description (optional)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <button type="submit" disabled={isUpdating}>
            Save
          </button>
          <button type="button" className="link-button" onClick={onDone}>
            Cancel
          </button>
          {error && <div className="error-text">{error}</div>}
        </form>
      </td>
    </tr>
  );
}

export function SourceGroupsPage() {
  const { sourceGroups, isLoading, deleteGroup } = useSourceGroups();
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const { confirmDelete, dialog } = useConfirmDialog();

  async function handleDelete(group: SourceGroup) {
    setDeleteError(null);
    if (!(await confirmDelete(`Delete Source Group "${group.name}"? Its Sources are kept, just ungrouped.`))) return;
    try {
      await deleteGroup(group.id);
    } catch (err) {
      setDeleteError(err instanceof ApiRequestError ? err.message : "Failed to delete Source Group");
    }
  }

  return (
    <div className="page">
      <div className="page-header-row">
        <h1>Source Groups</h1>
        <RequireRole minimum="admin">
          <button onClick={() => setShowForm((v) => !v)}>{showForm ? "Cancel" : "+ Add Source Group"}</button>
        </RequireRole>
      </div>
      <p className="hint-text">
        Cross-Emitter labels for categorizing Sources (e.g. "CED", "Intercepts") — see which Sources
        belong together and what RF/PW/PRI coverage they represent as a whole, regardless of which
        Emitter each one lives under.
      </p>

      {showForm && <SourceGroupForm onClose={() => setShowForm(false)} />}
      {deleteError && <div className="error-text">{deleteError}</div>}

      {isLoading ? (
        <LoadingState label="Loading source groups…" />
      ) : sourceGroups.length === 0 ? (
        <EmptyState
          icon="◇"
          title="No Source Groups yet"
          message="Create a group to start categorizing Sources across Emitters, or import a document — each import creates its own group automatically."
        />
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Sources</th>
              <th>Last updated source</th>
              <th>Last edited</th>
              <th>RF (engineered)</th>
              <th>PW (engineered)</th>
              <th>PRI (engineered, fixed only)</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {sourceGroups.map((g: SourceGroup) =>
              editingId === g.id ? (
                <EditGroupRow key={g.id} group={g} onDone={() => setEditingId(null)} />
              ) : (
                <tr key={g.id}>
                  <td>
                    {g.name}
                    {g.description && <div className="hint-text">{g.description}</div>}
                  </td>
                  <td>{g.source_count}</td>
                  <td>{g.last_updated_source_date ?? "—"}</td>
                  <td>{g.last_edited_at ? new Date(g.last_edited_at).toLocaleString() : "—"}</td>
                  <td>{rangeText(g.rf_min_mhz, g.rf_max_mhz, "MHz")}</td>
                  <td>{rangeText(g.pw_min_us, g.pw_max_us, "µs")}</td>
                  <td>
                    {rangeText(g.pri_min_us, g.pri_max_us, "µs")}
                    {g.pri_stagger_count > 0 && (
                      <div className="hint-text">
                        + {g.pri_stagger_count} stagger element(s) excluded from this range
                      </div>
                    )}
                  </td>
                  <td>
                    <RequireRole minimum="admin">
                      <button className="link-button" onClick={() => setEditingId(g.id)}>
                        Edit
                      </button>{" "}
                      <button className="link-button link-button-danger" onClick={() => void handleDelete(g)}>
                        Delete
                      </button>
                    </RequireRole>
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      )}
      {dialog}
    </div>
  );
}
