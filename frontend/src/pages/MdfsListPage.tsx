import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useCreateMdf, useMdfs } from "../state/hooks/useMdfs";
import { RequireRole } from "../auth/RequireAuth";
import { ApiRequestError } from "../api/client";

export function MdfsListPage() {
  const { data: mdfs, isLoading } = useMdfs();
  const createMdf = useCreateMdf();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);

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

      {isLoading && <p>Loading…</p>}
      <table className="data-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Description</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {mdfs?.map((m) => (
            <tr key={m.id}>
              <td>
                <Link to={`/mdfs/${m.id}`}>{m.name}</Link>
              </td>
              <td>{m.description ?? "—"}</td>
              <td>
                <span className={`status-badge status-${m.status}`}>{m.status.replace("_", " ")}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
