import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useEmitters } from "../state/hooks/useEmitters";
import { useDeleteIntercept, useIntercepts } from "../state/hooks/useIntercepts";
import { RequireRole } from "../auth/RequireAuth";
import { ApiRequestError } from "../api/client";
import { LoadingState } from "../components/common/LoadingState";
import { EmptyState } from "../components/common/EmptyState";
import { InterceptFormModal } from "../components/intercepts/InterceptFormModal";
import { formatDay } from "../components/intercepts/interceptFormat";
import { useConfirmDialog } from "../components/common/ConfirmDialog";
import { SortableColumnHeader } from "../components/common/SortableColumnHeader";
import { useSortableTable } from "../components/common/useSortableTable";
import { compareNullable, compareStrings } from "../components/common/sortUtils";
import type { Intercept } from "../types/domain";

type InterceptSortKey = "name" | "emitter" | "intercepted_on" | "collected_by" | "entry_count" | "created_at";

export function InterceptsPage() {
  const { data: emitters } = useEmitters();
  const { data: intercepts, isLoading, error } = useIntercepts();
  const deleteIntercept = useDeleteIntercept();
  const navigate = useNavigate();
  const { confirmDelete, dialog } = useConfirmDialog();

  const [showAddModal, setShowAddModal] = useState(false);
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
      case "intercepted_on":
        return compareNullable(a.intercepted_on, b.intercepted_on, dir);
      case "collected_by":
        return compareNullable(a.collected_by, b.collected_by, dir);
      case "entry_count":
        return compareNullable(a.entry_count, b.entry_count, dir);
      case "created_at":
        return compareStrings(a.created_at, b.created_at, dir);
    }
  }

  const filtered = (intercepts ?? []).filter((i) => {
    const nameQ = nameFilter.trim().toLowerCase();
    if (nameQ && ![i.name, i.collected_by ?? "", i.description ?? ""].some((t) => t.toLowerCase().includes(nameQ)))
      return false;
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
          <button className="button primary" onClick={() => setShowAddModal(true)}>
            + Add Intercept
          </button>
        </RequireRole>
      </div>
      <p className="hint-text">
        Logged real-world signal intercepts, searchable across every Emitter. Each Intercept holds one or
        more logged entries, and an entry can optionally be used to create a Mode.
      </p>

      {showAddModal && (
        <InterceptFormModal
          emitters={emitters}
          onClose={() => setShowAddModal(false)}
          onSaved={(saved) => navigate(`/intercepts/${saved.id}`)}
        />
      )}

      {error && <div className="error-text">{(error as Error).message}</div>}

      <div className="card">
        <div className="modes-toolbar-row">
          <input
            type="text"
            placeholder="Filter by name, collector or description…"
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
              {header("Recorded", "intercepted_on", "date")}
              {header("Collected by", "collected_by")}
              {header("Entries", "entry_count", "number")}
              {header("Logged", "created_at", "date")}
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
                <td>{formatDay(i.intercepted_on) ?? <span className="hint-text">—</span>}</td>
                <td>{i.collected_by ?? <span className="hint-text">—</span>}</td>
                <td>{i.entry_count}</td>
                <td>{new Date(i.created_at).toLocaleDateString()}</td>
                <td>
                  <RequireRole minimum="editor">
                    <button className="link-button link-button-danger" onClick={() => void handleDelete(i)}>
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
