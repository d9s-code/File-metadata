import { Fragment, useState } from "react";
import type { EwGroup, Source } from "../../types/domain";
import { useDeleteSource } from "../../state/hooks/useSources";
import { useElements } from "../../state/hooks/useElements";
import { useConfirmDialog } from "../common/ConfirmDialog";
import { ElementsPanel } from "./ElementsPanel";
import { CartesianProductButton } from "./CartesianProductButton";
import { DslEditor } from "../modes/DslEditor";
import { SourceForm } from "./SourceForm";
import { RequireRole } from "../../auth/RequireAuth";
import { ApiRequestError } from "../../api/client";

function ElementCounts({ emitterId, sourceId }: { emitterId: string; sourceId: string }) {
  const { data: elements } = useElements(emitterId, sourceId);
  if (!elements) return <span className="hint-text">—</span>;
  const counts = { rf: 0, pw: 0, pri: 0 };
  for (const el of elements) counts[el.element_type]++;
  return (
    <span className="hint-text">
      {counts.rf} RF · {counts.pw} PW · {counts.pri} PRI
    </span>
  );
}

export function SourcesTable({
  emitterId,
  sources,
  ewGroups,
}: {
  emitterId: string;
  sources: Source[];
  ewGroups: EwGroup[];
}) {
  const deleteSource = useDeleteSource(emitterId);
  const { confirmDelete, dialog } = useConfirmDialog();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function handleDelete(source: Source) {
    setDeleteError(null);
    if (!(await confirmDelete(`Delete Source "${source.name}"? It must have no Modes attached.`))) return;
    try {
      await deleteSource.mutateAsync(source.id);
    } catch (err) {
      setDeleteError(err instanceof ApiRequestError ? err.message : "Failed to delete source");
    }
  }

  return (
    <section className="card">
      <h4>Sources</h4>
      {sources.length === 0 ? (
        <p className="hint-text">No Sources yet.</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Description</th>
              <th>Date last updated</th>
              <th>Elements</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {sources.map((s) => (
              <Fragment key={s.id}>
                <tr>
                  <td>{s.name}</td>
                  <td>{s.description ?? "—"}</td>
                  <td>{s.source_date}</td>
                  <td>
                    <ElementCounts emitterId={emitterId} sourceId={s.id} />
                  </td>
                  <td>
                    <button
                      className="link-button"
                      onClick={() => setExpandedId(expandedId === s.id ? null : s.id)}
                    >
                      {expandedId === s.id ? "Hide elements & tools" : "Manage elements & generate modes"}
                    </button>{" "}
                    <RequireRole minimum="editor">
                      <button className="link-button" onClick={() => void handleDelete(s)}>
                        Delete
                      </button>
                    </RequireRole>
                  </td>
                </tr>
                {expandedId === s.id && (
                  <tr>
                    <td colSpan={5}>
                      <div className="source-detail">
                        <h5>Elements</h5>
                        <ElementsPanel emitterId={emitterId} sourceId={s.id} />
                        <RequireRole minimum="editor">
                          <h5>Editorial Tools</h5>
                          <CartesianProductButton emitterId={emitterId} sourceId={s.id} ewGroups={ewGroups} />
                          <DslEditor emitterId={emitterId} sourceId={s.id} ewGroups={ewGroups} />
                        </RequireRole>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      )}
      {deleteError && <div className="error-text">{deleteError}</div>}
      <RequireRole minimum="editor">
        {showForm ? (
          <SourceForm emitterId={emitterId} />
        ) : (
          <button className="icon-button" onClick={() => setShowForm(true)}>
            + Add Source
          </button>
        )}
      </RequireRole>
      {dialog}
    </section>
  );
}
