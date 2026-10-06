import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { JsonImportModal } from "../common/JsonImportModal";
import type { EwGroup, Source } from "../../types/domain";
import { useApproveSource, useDeleteSource } from "../../state/hooks/useSources";
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
import { SourceBatchAddModal } from "./SourceBatchAddModal";
import { RejectSourceModal } from "./RejectSourceModal";
import { RequireRole } from "../../auth/RequireAuth";
import { ApiRequestError } from "../../api/client";
import { EmptyState } from "../common/EmptyState";
import { SortableColumnHeader } from "../common/SortableColumnHeader";
import { useSortableTable } from "../common/useSortableTable";
import { compareStrings } from "../common/sortUtils";
import { statusLabel } from "../common/emitterStatusLabel";

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

type SourceDetailTab = "elements" | "sequences" | "generate" | "notes";

/** An opened Source, as tabs rather than one long stack: its Elements, its
 * Parameter Sequences, Cartesian Product (generate Modes), and its notes
 * with the Modes built from it. */
function SourceDetailTabs({
  emitterId,
  source,
  ewGroups,
  tab,
  onTab,
}: {
  emitterId: string;
  source: Source;
  ewGroups: EwGroup[];
  tab: SourceDetailTab;
  onTab: (tab: SourceDetailTab) => void;
}) {
  const { data: notes } = useSourceNotes(emitterId, source.id);
  const noteCount = notes?.length ?? 0;
  const tabs: [SourceDetailTab, string][] = [
    ["elements", "Elements"],
    ["sequences", "Sequences"],
    ["generate", "Generate Modes"],
    ["notes", noteCount > 0 ? `Analyst notes (${noteCount}) & coverage` : "Analyst notes & coverage"],
  ];
  return (
    <>
      <div className="sub-tab-bar source-overlay-tabs" role="tablist" aria-label={`${source.name} details`}>
        {tabs.map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            className={tab === key ? "sub-tab active" : "sub-tab"}
            onClick={() => onTab(key)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="source-overlay-body">
      {tab === "elements" && <ElementsPanel emitterId={emitterId} sourceId={source.id} />}
      {tab === "sequences" && <ParameterSequencesPanel emitterId={emitterId} sourceId={source.id} />}
      {tab === "generate" && (
        <RequireRole minimum="editor">
          <CartesianProductButton emitterId={emitterId} sourceId={source.id} ewGroups={ewGroups} />
        </RequireRole>
      )}
      {tab === "notes" && (
        <>
          <h5 className="mt-0">Analyst notes</h5>
          <SourceNotesEditor emitterId={emitterId} source={source} />
          <h5 className="mt-4">Coverage — Modes built from this Source</h5>
          <SourceCoverage emitterId={emitterId} sourceId={source.id} />
        </>
      )}
      </div>
    </>
  );
}

/** A Source opened over the page, at a fixed size: its tabs stay put and
 * only the body scrolls, so switching tabs never resizes anything. Previous
 * and Next step through the Sources in the order they're listed, staying on
 * the same tab. */
function SourceOverlay({
  emitterId,
  sources,
  sourceId,
  ewGroups,
  onNavigate,
  onClose,
}: {
  emitterId: string;
  /** In display order. */
  sources: Source[];
  sourceId: string;
  ewGroups: EwGroup[];
  onNavigate: (sourceId: string) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<SourceDetailTab>("elements");
  const index = sources.findIndex((s) => s.id === sourceId);
  const source = sources[index];
  const prev = index > 0 ? sources[index - 1] : null;
  const next = index >= 0 && index < sources.length - 1 ? sources[index + 1] : null;

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      // A form or confirm dialog opened from inside closes first.
      if (document.querySelectorAll(".modal-overlay").length > 1) return;
      onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  // The Source was deleted (or filtered away) while open.
  useEffect(() => {
    if (!source) onClose();
  }, [source, onClose]);
  if (!source) return null;

  return (
    <div className="modal-overlay source-overlay-backdrop" onClick={onClose}>
      <div
        className="source-overlay"
        role="dialog"
        aria-modal="true"
        aria-label={`Source ${source.name}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="source-overlay-header">
          <div className="source-overlay-title">
            <h3>
              {source.name}
              {source.status !== "approved" && (
                <span className={`status-badge status-${source.status}`}>{statusLabel(source.status)}</span>
              )}
            </h3>
            <div className="hint-text">
              {source.intercept_id && (
                <>
                  Stands for Intercept <Link to={`/intercepts/${source.intercept_id}`}>{source.intercept_name}</Link> ·{" "}
                </>
              )}
              Last updated {source.source_date}
              {source.rf_legacy_term && ` · ${source.rf_legacy_term}`}
              {source.pri_legacy_term && ` · PRI: ${source.pri_legacy_term}`}
            </div>
          </div>
          <div className="source-overlay-nav">
            <button type="button" className="button secondary small" disabled={!prev} onClick={() => prev && onNavigate(prev.id)}>
              ‹ Previous
            </button>
            <span className="hint-text">
              {index + 1} of {sources.length}
            </span>
            <button type="button" className="button secondary small" disabled={!next} onClick={() => next && onNavigate(next.id)}>
              Next ›
            </button>
            <button type="button" className="link-button" aria-label="Close" onClick={onClose}>
              ✕
            </button>
          </div>
        </div>
        {/* Keyed by Source so open forms and paging don't carry over to the next one. */}
        <SourceDetailTabs key={source.id} emitterId={emitterId} source={source} ewGroups={ewGroups} tab={tab} onTab={setTab} />
      </div>
    </div>
  );
}

export function SourcesTable({
  emitterId,
  sources,
  ewGroups,
  linkedSourceId,
}: {
  emitterId: string;
  sources: Source[];
  ewGroups: EwGroup[];
  /** From a ?source=… link (e.g. the Source Groups page): open that Source. */
  linkedSourceId?: string;
}) {
  const deleteSource = useDeleteSource(emitterId);
  const approveSource = useApproveSource(emitterId);
  const { data: allModes } = useEmitterModes(emitterId);
  const { data: emitter } = useEmitter(emitterId);
  const { sourceGroups } = useSourceGroups();
  const { canEdit } = useEmitterCheckoutState(emitter);
  const editTitle = canEdit ? undefined : "Start editing this Emitter first";
  const { confirmDelete, dialog } = useConfirmDialog();
  const [openSourceId, setOpenSourceId] = useState<string | null>(null);
  // Open a linked Source once it has loaded — and again if a new link arrives.
  useEffect(() => {
    if (linkedSourceId && sources.some((s) => s.id === linkedSourceId)) setOpenSourceId(linkedSourceId);
  }, [linkedSourceId, sources]);
  const [showForm, setShowForm] = useState(false);
  const [editingSource, setEditingSource] = useState<Source | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [rejectingSource, setRejectingSource] = useState<Source | null>(null);
  const [showJsonImport, setShowJsonImport] = useState(false);
  const queryClient = useQueryClient();
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showBatchAdd, setShowBatchAdd] = useState(false);
  const { sorted, sortKey, sortDir, onSort, onClear } = useSortableTable(sources, compareSources);

  const sourceNameById = useMemo(() => Object.fromEntries(sources.map((s) => [s.id, s.name])), [sources]);

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAllInGroup(ids: string[]) {
    setSelected((prev) => {
      const next = new Set(prev);
      const allSelected = ids.every((id) => next.has(id));
      for (const id of ids) {
        if (allSelected) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  }

  const modeCountBySource = useMemo(() => {
    const counts = new Map<string, number>();
    for (const m of allModes ?? []) counts.set(m.source_id, (counts.get(m.source_id) ?? 0) + 1);
    return counts;
  }, [allModes]);

  const groupNameById = useMemo(() => Object.fromEntries(sourceGroups.map((g) => [g.id, g.name])), [sourceGroups]);

  const closeOverlay = useCallback(() => setOpenSourceId(null), []);
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

  async function handleApprove(source: Source) {
    setDeleteError(null);
    try {
      await approveSource.mutateAsync(source.id);
    } catch (err) {
      setDeleteError(err instanceof ApiRequestError ? err.message : "Failed to approve source");
    }
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
      <div className="card-header">
        <h4>Sources</h4>
        <RequireRole minimum="editor">
          <div className="section-actions">
            <button
              className="button secondary small"
              disabled={!canEdit || showForm || !!editingSource}
              title={editTitle}
              onClick={() => setShowForm(true)}
            >
              + Add Source
            </button>
            <button
              className="button secondary small"
              disabled={!canEdit}
              title={canEdit ? "Import Sources, Elements and sequences from a JSON file" : editTitle}
              onClick={() => setShowJsonImport(true)}
            >
              Import JSON
            </button>
            <button
              className="button secondary small"
              disabled={!canEdit || selected.size === 0}
              title={!canEdit ? editTitle : selected.size === 0 ? "Select one or more Sources below first" : undefined}
              onClick={() => setShowBatchAdd(true)}
            >
              Batch Add{selected.size > 0 ? ` to ${selected.size} Source${selected.size === 1 ? "" : "s"}` : ""}
            </button>
            {selected.size > 0 && (
              <button className="link-button" onClick={() => setSelected(new Set())}>
                Clear selection
              </button>
            )}
          </div>
        </RequireRole>
      </div>
      <RequireRole minimum="editor">
        {editingSource ? (
          <SourceForm emitterId={emitterId} initialData={editingSource} onClose={() => setEditingSource(null)} />
        ) : showForm ? (
          <SourceForm emitterId={emitterId} onClose={() => setShowForm(false)} />
        ) : null}
      </RequireRole>
      {sources.length === 0 ? (
        <EmptyState
          icon="◇"
          title="No Sources yet"
          message="A Source records where a parameter set came from (a datasheet, a lab measurement) and holds the RF/PRI/PW elements you build Modes from."
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
                      <th>
                        <input
                          type="checkbox"
                          checked={section.items.every((s) => selected.has(s.id))}
                          onChange={(e) => {
                            e.stopPropagation();
                            toggleSelectAllInGroup(section.items.map((s) => s.id));
                          }}
                          title="Select all Sources in this group"
                        />
                      </th>
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
                            <input type="checkbox" checked={selected.has(s.id)} onChange={() => toggleSelected(s.id)} />
                          </td>
                          <td>
                            {s.name}
                            {s.intercept_id && (
                              <Link className="source-intercept-link" to={`/intercepts/${s.intercept_id}`} title="This Source stands for an Intercept">
                                Intercept
                              </Link>
                            )}
                            {s.status !== "approved" && (
                              <span className={`status-badge status-${s.status}`}>{statusLabel(s.status)}</span>
                            )}
                            {s.status === "rejected" && s.rejection_reason && (
                              <div className="hint-text rejection-reason">Rejected: {s.rejection_reason}</div>
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
                            <button className="link-button" onClick={() => setOpenSourceId(s.id)}>
                              Open
                            </button>{" "}
                            <RequireRole minimum="editor">
                              {s.status !== "approved" && (
                                <>
                                  <button
                                    className="link-button link-button-success"
                                    disabled={!canEdit || approveSource.isPending}
                                    title={editTitle}
                                    onClick={() => void handleApprove(s)}
                                  >
                                    Approve
                                  </button>{" "}
                                </>
                              )}
                              {s.status === "pending_review" && (
                                <>
                                  <button
                                    className="link-button link-button-danger"
                                    disabled={!canEdit}
                                    title={editTitle}
                                    onClick={() => setRejectingSource(s)}
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
                              <button className="link-button link-button-danger" disabled={!canEdit} title={editTitle} onClick={() => void handleDelete(s)}>
                                Delete
                              </button>
                            </RequireRole>
                          </td>
                        </tr>
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
      {openSourceId && (
        <SourceOverlay
          emitterId={emitterId}
          sources={sections.flatMap((section) => section.items)}
          sourceId={openSourceId}
          ewGroups={ewGroups}
          onNavigate={setOpenSourceId}
          onClose={closeOverlay}
        />
      )}
      {rejectingSource && (
        <RejectSourceModal emitterId={emitterId} source={rejectingSource} onClose={() => setRejectingSource(null)} />
      )}
      {showJsonImport && (
        <JsonImportModal
          emitterId={emitterId}
          onClose={() => setShowJsonImport(false)}
          onSuccess={() => queryClient.invalidateQueries({ queryKey: ["sources", emitterId] })}
        />
      )}
      {showBatchAdd && (
        <SourceBatchAddModal
          emitterId={emitterId}
          sourceIds={[...selected]}
          sourceNameById={sourceNameById}
          onClose={() => setShowBatchAdd(false)}
          onDone={() => {
            setShowBatchAdd(false);
            setSelected(new Set());
          }}
        />
      )}
      {dialog}
    </section>
  );
}
