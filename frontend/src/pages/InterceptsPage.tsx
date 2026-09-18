import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useEmitters } from "../state/hooks/useEmitters";
import { useCreateIntercept, useDeleteIntercept, useIntercepts } from "../state/hooks/useIntercepts";
import { RequireRole } from "../auth/RequireAuth";
import { ApiRequestError } from "../api/client";
import { LoadingState } from "../components/common/LoadingState";
import { EmptyState } from "../components/common/EmptyState";
import { Modal } from "../components/common/Modal";
import { useConfirmDialog } from "../components/common/ConfirmDialog";
import { SortableColumnHeader } from "../components/common/SortableColumnHeader";
import { useSortableTable } from "../components/common/useSortableTable";
import { compareNullable, compareStrings } from "../components/common/sortUtils";
import type { Intercept } from "../types/domain";

type InterceptSortKey = "name" | "emitter" | "entry_count" | "created_at";

export function InterceptsPage() {
  const { data: emitters } = useEmitters();
  const { data: intercepts, isLoading, error } = useIntercepts();
  const createIntercept = useCreateIntercept();
  const deleteIntercept = useDeleteIntercept();
  const navigate = useNavigate();
  const { confirmDelete, dialog } = useConfirmDialog();

  const [showAddModal, setShowAddModal] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [formEmitterId, setFormEmitterId] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [nameFilter, setNameFilter] = useState("");
  const [emitterFilter, setEmitterFilter] = useState("");

  const emitterNameById = Object.fromEntries((emitters ?? []).map((e) => [e.id, e.name]));

  function compareIntercepts(a: Intercept, b: Intercept, key: InterceptSortKey, dir: "asc" | "desc"): number {
    switch (key) {
      case "name":
        return compareStrings(a.name, b.name, dir);
      case "emitter":
        return compareStrings(emitterNameById[a.emitter_id] ?? "", emitterNameById[b.emitter_id] ?? "", dir);
      case "entry_count":
        return compareNullable(a.entry_count, b.entry_count, dir);
      case "created_at":
        return compareStrings(a.created_at, b.created_at, dir);
    }
  }

  const filtered = (intercepts ?? []).filter((i) => {
    const nameQ = nameFilter.trim().toLowerCase();
    if (nameQ && !i.name.toLowerCase().includes(nameQ)) return false;
    if (emitterFilter && i.emitter_id !== emitterFilter) return false;
    return true;
  });

  const { sorted, sortKey, sortDir, onSort, onClear } = useSortableTable(filtered, compareIntercepts);

  const header = (label: string, key: InterceptSortKey, columnType?: "string" | "number" | "date") => (
    <SortableColumnHeader
      label={label}
      columnKey={key}
      columnType={columnType}
      activeKey={sortKey}
      activeDir={sortDir}
      onSort={onSort}
      onClear={onClear}
    />
  );

  function resetFilters() {
    setNameFilter("");
    setEmitterFilter("");
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!formEmitterId) {
      setFormError("Choose an Emitter.");
      return;
    }
    try {
      const intercept = await createIntercept.mutateAsync({
        emitter_id: formEmitterId,
        name,
        description: description || undefined,
      });
      setName("");
      setDescription("");
      setFormEmitterId("");
      setShowAddModal(false);
      navigate(`/intercepts/${intercept.id}`);
    } catch (err) {
      setFormError(err instanceof ApiRequestError ? err.message : "Failed to create Intercept");
    }
  }

  async function handleDelete(intercept: Intercept) {
    setDeleteError(null);
    if (
      !(await confirmDelete(
        `Delete Intercept "${intercept.name}"? This removes all its entries and notes. Any Mode already created from an entry is unaffected.`,
      ))
    )
      return;
    try {
      await deleteIntercept.mutateAsync(intercept.id);
    } catch (err) {
      setDeleteError(err instanceof ApiRequestError ? err.message : "Failed to delete Intercept");
    }
  }

  return (
    <div className="page">
      <div className="page-header-row">
        <h1>Intercepts</h1>
        <RequireRole minimum="editor">
          <button onClick={() => setShowAddModal(true)}>+ Add Intercept</button>
        </RequireRole>
      </div>
      <p className="hint-text">
        Logged real-world signal intercepts, searchable across every Emitter. Each Intercept holds one or
        more logged entries, and an entry can optionally be used to create a Mode.
      </p>

      {showAddModal && (
        <Modal title="Add Intercept" onClose={() => setShowAddModal(false)}>
          <form onSubmit={handleCreate}>
            <div className="form-row">
              <select value={formEmitterId} onChange={(e) => setFormEmitterId(e.target.value)} required>
                <option value="" disabled>
                  Select Emitter…
                </option>
                {(emitters ?? []).map((em) => (
                  <option key={em.id} value={em.id}>
                    {em.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-row">
              <input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
            </div>
            <div className="form-row">
              <label className="wide-label">
                Description (optional)
                <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
              </label>
            </div>
            {formError && <div className="error-text">{formError}</div>}
            <div className="modal-actions">
              <button type="button" className="icon-button" onClick={() => setShowAddModal(false)}>
                Cancel
              </button>
              <button type="submit" disabled={createIntercept.isPending}>
                Add Intercept
              </button>
            </div>
          </form>
        </Modal>
      )}

      {error && <div className="error-text">{(error as Error).message}</div>}

      <div className="card">
        <div className="modes-toolbar-row">
          <input
            type="text"
            placeholder="Filter by name…"
            value={nameFilter}
            onChange={(e) => setNameFilter(e.target.value)}
          />
          <select value={emitterFilter} onChange={(e) => setEmitterFilter(e.target.value)}>
            <option value="">All Emitters</option>
            {(emitters ?? []).map((em) => (
              <option key={em.id} value={em.id}>
                {em.name}
              </option>
            ))}
          </select>
          <button type="button" className="link-button" onClick={resetFilters}>
            Reset filters
          </button>
        </div>
      </div>

      {isLoading ? (
        <LoadingState label="Loading intercepts…" />
      ) : (intercepts ?? []).length === 0 ? (
        <EmptyState
          icon="◇"
          title="No Intercepts yet"
          message="Log a real-world signal intercept against an Emitter — add one above."
        />
      ) : sorted.length === 0 ? (
        <EmptyState icon="◇" title="No matches" message="No Intercepts match the current search/filters." />
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              {header("Name", "name")}
              {header("Emitter", "emitter")}
              {header("Entries", "entry_count", "number")}
              {header("Created", "created_at", "date")}
              <th></th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((i) => (
              <tr key={i.id}>
                <td>
                  <Link to={`/intercepts/${i.id}`}>{i.name}</Link>
                </td>
                <td>
                  {emitterNameById[i.emitter_id] ? (
                    <Link to={`/emitters/${i.emitter_id}`}>{emitterNameById[i.emitter_id]}</Link>
                  ) : (
                    "—"
                  )}
                </td>
                <td>{i.entry_count}</td>
                <td>{new Date(i.created_at).toLocaleDateString()}</td>
                <td>
                  <RequireRole minimum="editor">
                    <button className="link-button" onClick={() => void handleDelete(i)}>
                      Delete
                    </button>
                  </RequireRole>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {deleteError && <div className="error-text">{deleteError}</div>}
      {dialog}
    </div>
  );
}
