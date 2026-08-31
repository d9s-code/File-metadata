import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useCreatePlatform, usePlatforms } from "../state/hooks/usePlatforms";
import { RequireRole } from "../auth/RequireAuth";
import { ApiRequestError } from "../api/client";
import { LoadingState } from "../components/common/LoadingState";
import { EmptyState } from "../components/common/EmptyState";
import { SortableColumnHeader } from "../components/common/SortableColumnHeader";
import { useSortableTable } from "../components/common/useSortableTable";
import { compareStrings } from "../components/common/sortUtils";
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
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await createPlatform.mutateAsync({ name, description: description || undefined });
      setName("");
      setDescription("");
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Failed to create platform");
    }
  }

  return (
    <div className="page">
      <h1>Platforms</h1>
      <p className="hint-text">Platforms group Emitters — this is what gets pinned into an MDF.</p>

      <RequireRole minimum="editor">
        <form className="card inline-form" onSubmit={handleCreate}>
          <input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} required />
          <input placeholder="Description" value={description} onChange={(e) => setDescription(e.target.value)} />
          <button type="submit" disabled={createPlatform.isPending}>
            Add Platform
          </button>
        </form>
        {error && <div className="error-text">{error}</div>}
      </RequireRole>

      {isLoading ? (
        <LoadingState label="Loading platforms…" />
      ) : platforms && platforms.length === 0 ? (
        <EmptyState icon="◇" title="No Platforms yet" message="Add one above, then pin committed Emitter versions to it." />
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
            </tr>
          </thead>
          <tbody>
            {sorted.map((p) => (
              <tr key={p.id}>
                <td>
                  <Link to={`/platforms/${p.id}`}>{p.name}</Link>
                </td>
                <td>{p.description ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
