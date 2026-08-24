import { useState } from "react";
import type { EwGroup, Source } from "../../types/domain";
import { useDeleteSource } from "../../state/hooks/useSources";
import { ElementsPanel } from "./ElementsPanel";
import { CartesianProductButton } from "./CartesianProductButton";
import { DslEditor } from "../modes/DslEditor";
import { RequireRole } from "../../auth/RequireAuth";
import { ApiRequestError } from "../../api/client";

export function SourceCard({
  emitterId,
  source,
  ewGroups,
}: {
  emitterId: string;
  source: Source;
  ewGroups: EwGroup[];
}) {
  const deleteSource = useDeleteSource(emitterId);
  const [expanded, setExpanded] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function handleDelete() {
    setDeleteError(null);
    try {
      await deleteSource.mutateAsync(source.id);
    } catch (err) {
      setDeleteError(err instanceof ApiRequestError ? err.message : "Failed to delete source");
    }
  }

  return (
    <section className="card source-card">
      <header className="source-card-header">
        <div>
          <h3>{source.name}</h3>
          <div className="ew-group-meta">
            <span>{source.description ?? "—"}</span>
            <span>Date last updated: {source.source_date}</span>
          </div>
        </div>
        <div>
          <button className="link-button" onClick={() => setExpanded((v) => !v)}>
            {expanded ? "Hide elements & tools" : "Manage elements & generate modes"}
          </button>
          <RequireRole minimum="editor">
            <button className="link-button" onClick={() => void handleDelete()}>
              Delete
            </button>
          </RequireRole>
        </div>
      </header>
      {deleteError && <div className="error-text">{deleteError}</div>}

      {expanded && (
        <div className="source-card-body">
          <h4>Elements</h4>
          <ElementsPanel emitterId={emitterId} sourceId={source.id} />

          <RequireRole minimum="editor">
            <h4>Editorial Tools</h4>
            <CartesianProductButton emitterId={emitterId} sourceId={source.id} ewGroups={ewGroups} />
            <DslEditor sourceId={source.id} ewGroups={ewGroups} />
          </RequireRole>
        </div>
      )}
    </section>
  );
}
