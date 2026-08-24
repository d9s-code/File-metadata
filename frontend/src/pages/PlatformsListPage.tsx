import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useCreatePlatform, usePlatforms } from "../state/hooks/usePlatforms";
import { RequireRole } from "../auth/RequireAuth";
import { ApiRequestError } from "../api/client";

export function PlatformsListPage() {
  const { data: platforms, isLoading } = usePlatforms();
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

      {isLoading && <p>Loading…</p>}
      <table className="data-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          {platforms?.map((p) => (
            <tr key={p.id}>
              <td>
                <Link to={`/platforms/${p.id}`}>{p.name}</Link>
              </td>
              <td>{p.description ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
