import type { Source } from "../../types/domain";
import { useDeleteSource } from "../../state/hooks/useSources";
import { RequireRole } from "../../auth/RequireAuth";
import { ApiRequestError } from "../../api/client";

export function SourcePanel({ emitterId, sources }: { emitterId: string; sources: Source[] }) {
  const deleteSource = useDeleteSource(emitterId);

  async function handleDelete(id: string) {
    try {
      await deleteSource.mutateAsync(id);
    } catch (err) {
      alert(err instanceof ApiRequestError ? err.message : "Failed to delete source");
    }
  }

  if (sources.length === 0) return <p className="hint-text">No sources yet.</p>;

  return (
    <table className="data-table">
      <thead>
        <tr>
          <th>Name</th>
          <th>Description</th>
          <th>Date last updated</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {sources.map((s) => (
          <tr key={s.id}>
            <td>{s.name}</td>
            <td>{s.description ?? "—"}</td>
            <td>{s.source_date}</td>
            <td>
              <RequireRole minimum="editor">
                <button className="link-button" onClick={() => void handleDelete(s.id)}>
                  Delete
                </button>
              </RequireRole>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
