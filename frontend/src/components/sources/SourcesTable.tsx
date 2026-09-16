import { Fragment, useMemo, useState } from "react";
import type { EwGroup, Source } from "../../types/domain";
import { useApproveSource, useDeleteSource, useRejectSource } from "../../state/hooks/useSources";
import { useCreateSourceNote, useDeleteSourceNote, useSourceNotes } from "../../state/hooks/useSourceNotes";
import { useSourceGroups } from "../../state/hooks/useSourceGroups";
import { useElements } from "../../state/hooks/useElements";
import { useEmitterModes } from "../../state/hooks/useModes";
import { useEmitter } from "../../state/hooks/useEmitters";
import { useEmitterCheckoutState } from "../../state/hooks/useEmitterCheckout";
import { useConfirmDialog } from "../common/ConfirmDialog";
import { NotesFeed } from "../common/NotesFeed";
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

const UNGROUPED_KEY = "__ungrouped__";

type SourceSortKey = "name" | "rf_legacy_term" | "pri_legacy_term" | "source_date" | "updated_at";

function compareSources(a: Source, b: Source, key: SourceSortKey, dir: "asc" | "desc"): number {
  switch (key) {
    case "name":
      return compareStrings(a.name, b.name, dir);
    case "rf_legacy_term":
      return compareStrings(a.rf_legacy_term, b.rf_legacy_term, dir);
    case "pri_legacy_term":
      return compareStrings(a.pri_legacy_term, b.pri_legacy_term, dir);
    case "source_date":
      return compareStrings(a.source_date, b.source_date, dir);
    case "updated_at":
      return compareStrings(a.updated_at, b.updated_at, dir);
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

/** Which Modes were built from this Source — answers "source coverage": at a
 * glance, has this Source's data actually been turned into any Modes yet? */
function SourceCoverage({ emitterId, sourceId }: { emitterId: string; sourceId: string }) {
  const { data: modes } = useEmitterModes(emitterId);
  const covering = (modes ?? []).filter((m) => m.source_id === sourceId);
  if (covering.length === 0) {
    return <span className="hint-text">No Modes built from this Source yet</span>;
  }
  return (
    <ul style={{ margin: 0, paddingLeft: "1.2rem" }}>
      {covering.map((m) => (
        <li key={m.id}>{m.name}</li>
      ))}
    </ul>
  );
}

function SourceNotesEditor({ emitterId, source }: { emitterId: string; source: Source }) {
  const { data: notes, isLoading } = useSourceNotes(emitterId, source.id);
  const { mutateAsync: createNote, isPending: isAdding } = useCreateSourceNote(emitterId, source.id);
  const { mutateAsync: deleteNote } = useDeleteSourceNote(emitterId, source.id);

  return (
    <NotesFeed
      notes={notes}
      isLoading={isLoading}
      placeholder="Your own thoughts/observations about this Source."
      onAdd={(body) => createNote(body)}
      isAdding={isAdding}
      onDelete={(noteId) => deleteNote(noteId)}
    />
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
  const { data: allModes } = useEmitterModes(emitterId);
  const { data: emitter } = useEmitter(emitterId);
  const { sourceGroups } = useSourceGroups();
  const { canEdit } = useEmitterCheckoutState(emitter);
  const editTitle = canEdit ? undefined : "Start editing this Emitter first";
  const { confirmDelete, dialog } = useConfirmDialog();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingSource, setEditingSource] = useState<Source | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isElementsCollapsed, setIsElementsCollapsed] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const { sorted, sortKey, sortDir, onSort, onClear } = useSortableTable(sources, compareSources);

  const modeCountBySource = useMemo(() => {
    const counts = new Map<string, number>();
    for (const m of allModes ?? []) counts.set(m.source_id, (counts.get(m.source_id) ?? 0) + 1);
    return counts;
  }, [allModes]);

  const groupNameById = useMemo(() => Object.fromEntries(sourceGroups.map((g) => [g.id, g.name])), [sourceGroups]);

  const sections = useMemo(() => {
    const byGroup = new Map<string, Source[]>();
    for (const s of sorted) {
      const key = s.group_id ?? UNGROUPED_KEY;
      const list = byGroup.get(key);
      if (list) list.push(s);
      else byGroup.set(key, [s]);
    }
    const groupKeys = [...byGroup.keys()].filter((k) => k !== UNGROUPED_KEY);
    groupKeys.sort((a, b) => (groupNameById[a] ?? "").localeCompare(groupNameById[b] ?? ""));
    const result = groupKeys.map((key) => ({ key, label: groupNameById[key] ?? "(unknown group)", items: byGroup.get(key)! }));
    if (byGroup.has(UNGROUPED_KEY)) {
      result.push({ key: UNGROUPED_KEY, label: "Ungrouped", items: byGroup.get(UNGROUPED_KEY)! });
    }
    return result;
  }, [sorted, groupNameById]);

  function toggleGroup(key: string) {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

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
        sections.map((section) => {
          const isCollapsed = collapsedGroups.has(section.key);
          return (
            <div key={section.key} className="source-group-section">
              <button type="button" className="source-group-header" onClick={() => toggleGroup(section.key)}>
                <span className="source-group-toggle">{isCollapsed ? "▶" : "▼"}</span>
                <strong>{section.label}</strong>
                <span className="hint-text">
                  {section.items.length} Source{section.items.length === 1 ? "" : "s"}
                </span>
              </button>
              {!isCollapsed && (
                <table className="data-table">
                  <thead>
                    <tr>
                      <SortableColumnHeader label="Name" columnKey="name" activeKey={sortKey} activeDir={sortDir} onSort={onSort} onClear={onClear} />
                      <SortableColumnHeader
                        label="Description"
                        columnKey="rf_legacy_term"
                        activeKey={sortKey}
                        activeDir={sortDir}
                        onSort={onSort}
                        onClear={onClear}
                      />
                      <SortableColumnHeader
                        label="PRI Legacy Term"
                        columnKey="pri_legacy_term"
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
                      <SortableColumnHeader
                        label="Last edited"
                        columnKey="updated_at"
                        columnType="date"
                        activeKey={sortKey}
                        activeDir={sortDir}
                        onSort={onSort}
                        onClear={onClear}
                      />
                      <th>Elements</th>
                      <th title="How many Modes have been built from this Source — see 'which Modes cover which Source'">
                        Modes
                      </th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {section.items.map((s) => (
                      <Fragment key={s.id}>
                        <tr>
                          <td>
                            {s.name}
                            {s.status !== "approved" && (
                              <span className={`status-badge status-${s.status}`}>{s.status.replace("_", " ")}</span>
                            )}
                          </td>
                          <td>{s.rf_legacy_term ?? "—"}</td>
                          <td>{s.pri_legacy_term ?? "—"}</td>
                          <td>{s.source_date}</td>
                          <td>{new Date(s.updated_at).toLocaleString()}</td>
                          <td>
                            <ElementCounts emitterId={emitterId} sourceId={s.id} />
                          </td>
                          <td>
                            {modeCountBySource.get(s.id) ? (
                              <span className="hint-text">{modeCountBySource.get(s.id)} Mode(s)</span>
                            ) : (
                              <span className="hint-text">—</span>
                            )}
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
                                    disabled={!canEdit || approveSource.isPending}
                                    title={editTitle}
                                    onClick={() => void approveSource.mutateAsync(s.id)}
                                  >
                                    Approve
                                  </button>{" "}
                                  <button
                                    className="link-button"
                                    disabled={!canEdit || rejectSource.isPending}
                                    title={editTitle}
                                    onClick={() => void rejectSource.mutateAsync(s.id)}
                                  >
                                    Reject
                                  </button>{" "}
                                </>
                              )}
                              <button
                                className="link-button"
                                disabled={!canEdit}
                                title={editTitle}
                                onClick={() => {
                                  setEditingSource(s);
                                  setShowForm(false);
                                }}
                              >
                                Edit
                              </button>{" "}
                              <button className="link-button" disabled={!canEdit} title={editTitle} onClick={() => void handleDelete(s)}>
                                Delete
                              </button>
                            </RequireRole>
                          </td>
                        </tr>
                        {expandedId === s.id && (
                          <tr>
                            <td colSpan={8}>
                              <div className="source-detail">
                                <h5 className="mt-0">Analyst notes</h5>
                                <SourceNotesEditor emitterId={emitterId} source={s} />

                                <h5 className="mt-4">Coverage — Modes built from this Source</h5>
                                <SourceCoverage emitterId={emitterId} sourceId={s.id} />

                                <div className="mb-4 mt-4">
                                  <button
                                    onClick={() => setIsElementsCollapsed(!isElementsCollapsed)}
                                    className="text-sm text-blue-600 hover:underline"
                                  >
                                    {isElementsCollapsed ? "Show elements & sequences" : "Hide elements & sequences"}
                                  </button>
                                </div>
                                {!isElementsCollapsed && (
                                  <>
                                    <ElementsPanel emitterId={emitterId} sourceId={s.id} />
                                    <h5 className="mt-4">Parameter Sequences</h5>
                                    <ParameterSequencesPanel emitterId={emitterId} sourceId={s.id} />
                                  </>
                                )}
                                <RequireRole minimum="editor">
                                  <h5 className="mt-4">Editorial Tools</h5>
                                  <div className="action-bar">
                                    <CartesianProductButton emitterId={emitterId} sourceId={s.id} ewGroups={ewGroups} />
                                  </div>
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
            </div>
          );
        })
      )}
      {deleteError && <div className="error-text">{deleteError}</div>}
      <RequireRole minimum="editor">
        {editingSource ? (
          <SourceForm emitterId={emitterId} initialData={editingSource} onClose={() => setEditingSource(null)} />
        ) : showForm ? (
          <SourceForm emitterId={emitterId} onClose={() => setShowForm(false)} />
        ) : (
          <button className="icon-button" disabled={!canEdit} title={editTitle} onClick={() => setShowForm(true)}>
            + Add Source
          </button>
        )}
      </RequireRole>
      {dialog}
    </section>
  );
}
