import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useCreateIntercept, useIntercepts } from "../../state/hooks/useIntercepts";
import { RequireRole } from "../../auth/RequireAuth";
import { ApiRequestError } from "../../api/client";
import { LoadingState } from "../common/LoadingState";
import { EmptyState } from "../common/EmptyState";

export function EmitterIntercepts({ emitterId }: { emitterId: string }) {
  const { data: intercepts, isLoading } = useIntercepts({ emitterId });
  const createIntercept = useCreateIntercept();
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await createIntercept.mutateAsync({ emitter_id: emitterId, name, description: description || undefined });
      setName("");
      setDescription("");
      setShowForm(false);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Failed to create Intercept");
    }
  }

  return (
    <section className="card">
      <h4>Intercepts</h4>
      <p className="hint-text">Real-world signal intercepts logged against this Emitter.</p>

      {isLoading ? (
        <LoadingState label="Loading intercepts…" />
      ) : !intercepts || intercepts.length === 0 ? (
        <EmptyState icon="◇" title="No Intercepts yet" message="Log a real-world signal intercept — add one below." />
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Entries</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {intercepts.map((i) => (
              <tr key={i.id}>
                <td>
                  <Link to={`/intercepts/${i.id}`}>{i.name}</Link>
                </td>
                <td>{i.entry_count}</td>
                <td>{new Date(i.created_at).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <RequireRole minimum="editor">
        {showForm ? (
          <form className="card inline-form" onSubmit={handleCreate}>
            <input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
            <input
              placeholder="Description (optional)"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
            <button type="submit" disabled={createIntercept.isPending}>
              Add Intercept
            </button>
            <button type="button" className="icon-button" onClick={() => setShowForm(false)}>
              Cancel
            </button>
            {error && <div className="error-text">{error}</div>}
          </form>
        ) : (
          <button className="icon-button" onClick={() => setShowForm(true)}>
            + Add Intercept
          </button>
        )}
      </RequireRole>
    </section>
  );
}
