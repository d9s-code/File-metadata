import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useCreateMdf, useDeleteMdf, useMdfs } from "../state/hooks/useMdfs";
import { RequireRole } from "../auth/RequireAuth";
import { ApiRequestError } from "../api/client";
import { LoadingState } from "../components/common/LoadingState";
import { EmptyState } from "../components/common/EmptyState";
import { SortableColumnHeader } from "../components/common/SortableColumnHeader";
import { useSortableTable } from "../components/common/useSortableTable";
import { compareStrings } from "../components/common/sortUtils";
import { useConfirmDialog } from "../components/common/ConfirmDialog";
import type { Mdf } from "../api/mdfs";

type MdfSortKey = "name" | "description" | "status";

function compareMdfs(a: Mdf, b: Mdf, key: MdfSortKey, dir: "asc" | "desc"): number {
  switch (key) {
    case "name":
      return compareStrings(a.name, b.name, dir);
    case "description":
      return compareStrings(a.description, b.description, dir);
    case "status":
      return compareStrings(a.status, b.status, dir);
  }
}

export function MdfsListPage() {
  const { data: mdfs, isLoading } = useMdfs();
  const { sorted, sortKey, sortDir, onSort, onClear } = useSortableTable(mdfs ?? [], compareMdfs);
  const createMdf = useCreateMdf();
  const deleteMdf = useDeleteMdf();
  const { confirmDelete, dialog } = useConfirmDialog();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function handleDelete(mdf: Mdf) {
    if (await confirmDelete(`Delete MDF "${mdf.name}"? It can be restored from Recently Deleted for 30 days.`)) {
      await deleteMdf.mutateAsync({ id: mdf.id });
    }
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await createMdf.mutateAsync({ name, description: description || undefined });
      setName("");
      setDescription("");
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Failed to create MDF");
    }
  }

  return (
    <div className="page">
      <h1>Mission Data Files</h1>

      <RequireRole minimum="editor">
        <form className="card inline-form" onSubmit={handleCreate}>
          <input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} required />
          <input placeholder="Description" value={description} onChange={(e) => setDescription(e.target.value)} />
          <button type="submit" disabled={createMdf.isPending}>
            Add MDF
          </button>
        </form>
        {error && <div className="error-text">{error}</div>}
      </RequireRole>

      {isLoading ? (
        <LoadingState label="Loading MDFs…" />
      ) : mdfs && mdfs.length === 0 ? (
        <EmptyState icon="◇" title="No MDFs yet" message="Add one above, then pin committed Platform versions to it." />
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
              <SortableColumnHeader
                label="Status"
                columnKey="status"
                activeKey={sortKey}
                activeDir={sortDir}
                onSort={onSort}
                onClear={onClear}
              />
              <th></th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((m) => (
              <tr key={m.id}>
                <td>
                  <Link to={`/mdfs/${m.id}`}>{m.name}</Link>
                </td>
                <td>{m.description ?? "—"}</td>
                <td>
                  <span className={`status-badge status-${m.status}`}>{m.status.replace("_", " ")}</span>
                </td>
                <td>
                  <RequireRole minimum="editor">
                    <button className="link-button" onClick={() => void handleDelete(m)}>
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
