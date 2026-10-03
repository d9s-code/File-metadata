import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useCreatePlatform, useDeletePlatform, usePlatforms } from "../state/hooks/usePlatforms";
import { RequireRole } from "../auth/RequireAuth";
import { ApiRequestError } from "../api/client";
import { LoadingState } from "../components/common/LoadingState";
import { EmptyState } from "../components/common/EmptyState";
import { Modal } from "../components/common/Modal";
import { SortableColumnHeader } from "../components/common/SortableColumnHeader";
import { useSortableTable } from "../components/common/useSortableTable";
import { compareStrings } from "../components/common/sortUtils";
import { useConfirmDialog } from "../components/common/ConfirmDialog";
import type { Platform } from "../api/platforms";

type PlatformSortKey = "name" | "description";

function comparePlatforms(a: Platform, b: Platform, key: PlatformSortKey, dir: "asc" | "desc"): number {
  switch (key) {
    case "name":
      return compareStrings(a.name, b.name, dir);
    case "description":
      return compareStrings(a.description, b.description, dir);
  }
}

export function PlatformsListPage() {
  const { data: platforms, isLoading } = usePlatforms();
  const { sorted, sortKey, sortDir, onSort, onClear } = useSortableTable(platforms ?? [], comparePlatforms);
  const createPlatform = useCreatePlatform();
  const deletePlatform = useDeletePlatform();
  const { confirmDelete, dialog } = useConfirmDialog();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [filter, setFilter] = useState("");
  const navigate = useNavigate();

  async function handleDelete(platform: Platform) {
    if (await confirmDelete(`Delete Platform "${platform.name}"? It can be restored from Recently Deleted for 30 days.`)) {
      await deletePlatform.mutateAsync({ id: platform.id });
    }
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const platform = await createPlatform.mutateAsync({ name, description: description || undefined });
      setName("");
      setDescription("");
      setShowAdd(false);
      navigate(`/platforms/${platform.id}`);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Failed to create platform");
    }
  }

  const query = filter.trim().toLowerCase();
  const visible = query
    ? sorted.filter((p) => `${p.name} ${p.description ?? ""}`.toLowerCase().includes(query))
    : sorted;

  return (
    <div className="page">
      <div className="page-header-row">
        <h1>Platforms</h1>
        <RequireRole minimum="editor">
          <button onClick={() => setShowAdd(true)}>+ Add Platform</button>
        </RequireRole>
      </div>
      <p className="hint-text">Platforms group Emitters — this is what gets pinned into an MDF.</p>

      {showAdd && (
        <Modal title="Add Platform" onClose={() => setShowAdd(false)}>
          <form onSubmit={handleCreate}>
            <div className="form-row">
              <input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
            </div>
            <div className="form-row">
              <label className="wide-label">
                Description (optional)
                <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
              </label>
            </div>
            {error && <div className="error-text">{error}</div>}
            <div className="modal-actions">
              <button type="button" className="button secondary" onClick={() => setShowAdd(false)}>
                Cancel
              </button>
              <button type="submit" className="button primary" disabled={createPlatform.isPending}>
                Add Platform
              </button>
            </div>
          </form>
        </Modal>
      )}

      {platforms && platforms.length > 0 && (
        <div className="card">
          <div className="modes-toolbar-row">
            <input placeholder="Filter by name or description…" value={filter} onChange={(e) => setFilter(e.target.value)} />
            <button type="button" className="link-button" onClick={() => setFilter("")}>
              Reset filters
            </button>
          </div>
        </div>
      )}

      {isLoading ? (
        <LoadingState label="Loading platforms…" />
      ) : platforms && platforms.length === 0 ? (
        <EmptyState icon="◇" title="No Platforms yet" message="Add one with + Add Platform, then pin saved Emitter versions to it." />
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <SortableColumnHeader
                label="Name"
                columnKey="name"
                activeKey={sortKey}
                activeDir={sortDir}
                onSort={onSort}
                onClear={onClear}
              />
              <SortableColumnHeader
                label="Description"
                columnKey="description"
                activeKey={sortKey}
                activeDir={sortDir}
                onSort={onSort}
                onClear={onClear}
              />
              <th></th>
            </tr>
          </thead>
          <tbody>
            {visible.map((p) => (
              <tr key={p.id}>
                <td>
                  <Link to={`/platforms/${p.id}`}>{p.name}</Link>
                </td>
                <td>{p.description ?? "—"}</td>
                <td>
                  <RequireRole minimum="editor">
                    <button className="link-button link-button-danger" onClick={() => void handleDelete(p)}>
                      Delete
                    </button>
                  </RequireRole>
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
