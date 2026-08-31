import { Fragment, useState } from "react";
import type { EwGroup, Source } from "../../types/domain";
import { useApproveSource, useDeleteSource, useRejectSource } from "../../state/hooks/useSources";
import { useElements } from "../../state/hooks/useElements";
import { useConfirmDialog } from "../common/ConfirmDialog";
import { ElementsPanel } from "./ElementsPanel";
import { ParameterSequencesPanel } from "./ParameterSequencesPanel";
import { CartesianProductButton } from "./CartesianProductButton";
import { SourceForm } from "./SourceForm";
import { RequireRole } from "../../auth/RequireAuth";
import { ApiRequestError } from "../../api/client";
import { EmptyState } from "../common/EmptyState";
import { SortableColumnHeader } from "../common/SortableColumnHeader";
import { useSortableTable } from "../common/useSortableTable";
import { compareStrings } from "../common/sortUtils";

type SourceSortKey = "name" | "description" | "source_date";

function compareSources(a: Source, b: Source, key: SourceSortKey, dir: "asc" | "desc"): number {
  switch (key) {
    case "name":
      return compareStrings(a.name, b.name, dir);
    case "description":
      return compareStrings(a.description, b.description, dir);
    case "source_date":
      return compareStrings(a.source_date, b.source_date, dir);
  }
}

function ElementCounts({ emitterId, sourceId }: { emitterId: string; sourceId: string }) {
  const { data: elements } = useElements(emitterId, sourceId);
  if (!elements) return <span className="hint-text">—</span>;
  const counts = { rf: 0, pw: 0, pri: 0, scan: 0 };
  for (const el of elements) counts[el.element_type]++;
  return (
    <span className="hint-text">
      {counts.rf} RF · {counts.pw} PW · {counts.pri} PRI · {counts.scan} Scan
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
  const approveSource = useApproveSource(emitterId);
  const rejectSource = useRejectSource(emitterId);
  const { confirmDelete, dialog } = useConfirmDialog();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const { sorted, sortKey, sortDir, onSort, onClear } = useSortableTable(sources, compareSources);

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
        <EmptyState
          icon="◇"
          title="No Sources yet"
          message="A Source records where a parameter set came from (a datasheet, a lab measurement) and holds the RF/PW/PRI elements you build Modes from."
        />
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <SortableColumnHeader label="Name" columnKey="name" activeKey={sortKey} activeDir={sortDir} onSort={onSort} onClear={onClear} />
              <SortableColumnHeader
                label="Description"
                columnKey="description"
                activeKey={sortKey}
                activeDir={sortDir}
                onSort={onSort}
                onClear={onClear}
              />
              <SortableColumnHeader
                label="Date last updated"
                columnKey="source_date"
                columnType="date"
                activeKey={sortKey}
                activeDir={sortDir}
                onSort={onSort}
                onClear={onClear}
              />
              <th>Elements</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((s) => (
              <Fragment key={s.id}>
                <tr>
                  <td>
                    {s.name}
                    {s.status !== "approved" && (
                      <span className={`status-badge status-${s.status}`}>{s.status.replace("_", " ")}</span>
                    )}
                  </td>
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
                      {s.status === "pending_review" && (
                        <>
                          <button
                            className="link-button"
                            disabled={approveSource.isPending}
                            onClick={() => void approveSource.mutateAsync(s.id)}
                          >
                            Approve
                          </button>{" "}
                          <button
                            className="link-button"
                            disabled={rejectSource.isPending}
                            onClick={() => void rejectSource.mutateAsync(s.id)}
                          >
                            Reject
                          </button>{" "}
                        </>
                      )}
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
                        <h5>Parameter Sequences</h5>
                        <ParameterSequencesPanel emitterId={emitterId} sourceId={s.id} />
                        <RequireRole minimum="editor">
                          <h5>Editorial Tools</h5>
                          <div className="action-bar">
                            <button className="icon-button" disabled title="Coming soon">
                              Import from XML
                            </button>
                            <span className="coming-soon-badge">coming soon</span>
                          </div>
                          <CartesianProductButton emitterId={emitterId} sourceId={s.id} ewGroups={ewGroups} />
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
