import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useCreateEmitter, useEmitters } from "../state/hooks/useEmitters";
import { RequireRole } from "../auth/RequireAuth";
import { ApiRequestError } from "../api/client";

export function EmittersListPage() {
  const { data: emitters, isLoading, error } = useEmitters();
  const createEmitter = useCreateEmitter();
  const [name, setName] = useState("");
  const [designation, setDesignation] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    try {
      await createEmitter.mutateAsync({ name, designation: designation || undefined });
      setName("");
      setDesignation("");
    } catch (err) {
      setFormError(err instanceof ApiRequestError ? err.message : "Failed to create emitter");
    }
  }

  return (
    <div className="page">
      <h1>Emitters</h1>

      <RequireRole minimum="editor">
        <form className="card inline-form" onSubmit={handleCreate}>
          <input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} required />
          <input
            placeholder="Designation (optional)"
            value={designation}
            onChange={(e) => setDesignation(e.target.value)}
          />
          <button type="submit" disabled={createEmitter.isPending}>
            Add Emitter
          </button>
        </form>
        {formError && <div className="error-text">{formError}</div>}
      </RequireRole>

      {isLoading && <p>Loading…</p>}
      {error && <div className="error-text">{(error as Error).message}</div>}

      <table className="data-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Designation</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {emitters?.map((e) => (
            <tr key={e.id}>
              <td>
                <Link to={`/emitters/${e.id}`}>{e.name}</Link>
              </td>
              <td>{e.designation ?? "—"}</td>
              <td>
                <span className={`status-badge status-${e.status}`}>{e.status}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
