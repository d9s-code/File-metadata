import { Fragment, useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useSourceGroups, useSourcesOverview } from "../state/hooks/useSourceGroups";
import type { SourceOverview } from "../api/source_groups";
import { SortableColumnHeader } from "../components/common/SortableColumnHeader";
import { useSortableTable } from "../components/common/useSortableTable";
import { compareNullable, compareStrings } from "../components/common/sortUtils";
import { SourceGroupForm } from "../components/sources/SourceGroupForm";
import { RequireRole } from "../auth/RequireAuth";
import { LoadingState } from "../components/common/LoadingState";
import { EmptyState } from "../components/common/EmptyState";
import { useConfirmDialog } from "../components/common/ConfirmDialog";
import { ApiRequestError } from "../api/client";
import type { SourceGroup } from "../types/domain";

function rangeText(min: number | null, max: number | null, unit: string): string {
  if (min == null || max == null) return "—";
  return `${min}–${max} ${unit}`;
}

function EditGroupRow({ group, onDone }: { group: SourceGroup; onDone: () => void }) {
  const { updateGroup, isUpdating } = useSourceGroups();
  const [name, setName] = useState(group.name);
  const [description, setDescription] = useState(group.description ?? "");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await updateGroup({ id: group.id, input: { name, description } });
      onDone();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Failed to update Source Group");
    }
  }

  return (
    <tr>
      <td colSpan={9}>
        <form className="inline-form" onSubmit={handleSubmit}>
          <input value={name} onChange={(e) => setName(e.target.value)} required />
          <input
            placeholder="Description (optional)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <button type="submit" disabled={isUpdating}>
            Save
          </button>
          <button type="button" className="link-button" onClick={onDone}>
            Cancel
          </button>
          {error && <div className="error-text">{error}</div>}
        </form>
      </td>
    </tr>
  );
}

const NO_GROUP = "__none__";

/** "3.2 years ago", "5 months ago", "12 days ago". */
function age(day: string, now = Date.now()): string {
  const days = Math.floor((now - Date.parse(`${day}T00:00:00`)) / 86_400_000);
  if (days < 0) return "in the future";
  if (days < 60) return `${days} day${days === 1 ? "" : "s"} ago`;
  if (days < 730) return `${Math.round(days / 30.4)} months ago`;
  return `${(days / 365.25).toFixed(1)} years ago`;
}

function monthsAgo(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return d.toISOString().slice(0, 10);
}

interface Query {
  text: string;
  from: string;
  to: string;
  status: string;
  type: string;
  ungrouped: boolean;
}
const NO_QUERY: Query = { text: "", from: "", to: "", status: "", type: "", ungrouped: true };

/** Oldest and newest "Date last updated", and latest edit, across Sources. */
function span(sources: SourceOverview[]) {
  let oldest: string | null = null;
  let newest: string | null = null;
  let edited: string | null = null;
  for (const s of sources) {
    if (!oldest || s.source_date < oldest) oldest = s.source_date;
    if (!newest || s.source_date > newest) newest = s.source_date;
    if (!edited || s.updated_at > edited) edited = s.updated_at;
  }
  return { oldest, newest, edited };
}

function DateCell({ day }: { day: string | null }) {
  if (!day) return <span className="hint-text">—</span>;
  return (
    <>
      {day}
      <div className="hint-text cell-subline">{age(day)}</div>
    </>
  );
}

function sourceLink(s: SourceOverview) {
  return `/emitters/${s.emitter_id}?tab=setup&source=${s.id}`;
}

type ListSortKey = "name" | "emitter" | "group" | "source_date" | "updated_at" | "status" | "element_count";

function compareSourceRows(a: SourceOverview, b: SourceOverview, key: ListSortKey, dir: "asc" | "desc") {
  switch (key) {
    case "name":
      return compareStrings(a.name, b.name, dir);
    case "emitter":
      return compareStrings(a.emitter_name, b.emitter_name, dir);
    case "group":
      return compareNullable(a.group_name, b.group_name, dir);
    case "source_date":
      return compareStrings(a.source_date, b.source_date, dir);
    case "updated_at":
      return compareStrings(a.updated_at, b.updated_at, dir);
    case "status":
      return compareStrings(a.status, b.status, dir);
    case "element_count":
      return compareNullable(a.element_count, b.element_count, dir);
  }
}

function SourceList({ sources }: { sources: SourceOverview[] }) {
  // Oldest first: the list is for finding what's out of date.
  const { sorted, sortKey, sortDir, onSort, onClear } = useSortableTable<SourceOverview, ListSortKey>(
    sources,
    compareSourceRows,
    { key: "source_date", dir: "asc" },
  );
  const header = (label: string, key: ListSortKey, columnType?: "string" | "number" | "date") => (
    <SortableColumnHeader
      label={label}
      columnKey={key}
      columnType={columnType}
      activeKey={sortKey}
      activeDir={sortDir}
      onSort={onSort}
      onClear={onClear}
    />
  );
  return (
    <table className="data-table source-tree-table">
      <thead>
        <tr>
          {header("Source", "name")}
          {header("Emitter", "emitter")}
          {header("Group", "group")}
          {header("Date last updated", "source_date", "date")}
          {header("Last edited", "updated_at", "date")}
          {header("Status", "status")}
          {header("Elements", "element_count", "number")}
          <th>Sequences</th>
          <th>Modes</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((s) => (
          <tr key={s.id}>
            <td>
              <Link to={sourceLink(s)}>{s.name}</Link>
              {s.source_type && <div className="hint-text cell-subline">{s.source_type}</div>}
            </td>
            <td>
              <Link to={`/emitters/${s.emitter_id}`}>{s.emitter_name}</Link>
              {s.emitter_designation && <div className="hint-text cell-subline">{s.emitter_designation}</div>}
            </td>
            <td>{s.group_name ?? <span className="hint-text">No group</span>}</td>
            <td>
              <DateCell day={s.source_date} />
            </td>
            <td>{new Date(s.updated_at).toLocaleDateString()}</td>
            <td>
              <span className={`status-badge status-${s.status}`}>{s.status.replace("_", " ")}</span>
            </td>
            <td>{s.element_count}</td>
            <td>{s.sequence_count}</td>
            <td>{s.mode_count}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function SourceGroupsPage() {
  const { sourceGroups, isLoading, deleteGroup } = useSourceGroups();
  const { data: overview, isLoading: overviewLoading } = useSourcesOverview();
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const { confirmDelete, dialog } = useConfirmDialog();
  const [query, setQuery] = useState<Query>(NO_QUERY);
  const [view, setView] = useState<"tree" | "list">("tree");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  async function handleDelete(group: SourceGroup) {
    setDeleteError(null);
    if (!(await confirmDelete(`Delete Source Group "${group.name}"? Its Sources are kept, just ungrouped.`))) return;
    try {
      await deleteGroup(group.id);
    } catch (err) {
      setDeleteError(err instanceof ApiRequestError ? err.message : "Failed to delete Source Group");
    }
  }

  const querying = JSON.stringify(query) !== JSON.stringify(NO_QUERY);
  const types = useMemo(
    () => [...new Set((overview ?? []).map((s) => s.source_type).filter((t): t is string => !!t))].sort(),
    [overview],
  );
  const matching = useMemo(() => {
    const text = query.text.trim().toLowerCase();
    return (overview ?? []).filter((s) => {
      if (!query.ungrouped && !s.group_id) return false;
      if (query.from && s.source_date < query.from) return false;
      if (query.to && s.source_date > query.to) return false;
      if (query.status && s.status !== query.status) return false;
      if (query.type && s.source_type !== query.type) return false;
      if (
        text &&
        ![s.name, s.emitter_name, s.emitter_designation ?? "", s.group_name ?? "", s.source_type ?? ""].some((v) =>
          v.toLowerCase().includes(text),
        )
      )
        return false;
      return true;
    });
  }, [overview, query]);

  // Group -> Emitter -> Sources, from the matching Sources.
  const tree = useMemo(() => {
    const byGroup = new Map<string, Map<string, SourceOverview[]>>();
    for (const s of matching) {
      const g = s.group_id ?? NO_GROUP;
      const emitters = byGroup.get(g) ?? new Map<string, SourceOverview[]>();
      emitters.set(s.emitter_id, [...(emitters.get(s.emitter_id) ?? []), s]);
      byGroup.set(g, emitters);
    }
    return byGroup;
  }, [matching]);

  const groupRows = [
    ...sourceGroups.filter((g) => !querying || tree.has(g.id)).map((g) => ({ id: g.id, group: g as SourceGroup | null })),
    ...(tree.has(NO_GROUP) ? [{ id: NO_GROUP, group: null }] : []),
  ];
  const isOpen = (key: string) => expanded.has(key) || (querying && query.text.trim() !== "");
  function toggle(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }
  function expandAll() {
    const keys = new Set<string>();
    for (const [g, emitters] of tree) {
      keys.add(g);
      for (const e of emitters.keys()) keys.add(`${g}/${e}`);
    }
    setExpanded(keys);
  }
  const total = span(matching);
  const emitterCount = new Set(matching.map((s) => s.emitter_id)).size;
  const set = <K extends keyof Query>(key: K, value: Query[K]) => setQuery((q) => ({ ...q, [key]: value }));

  return (
    <div className="page">
      <div className="page-header-row">
        <h1>Source Groups</h1>
        <RequireRole minimum="admin">
          <button onClick={() => setShowForm((v) => !v)}>{showForm ? "Cancel" : "+ Add Source Group"}</button>
        </RequireRole>
      </div>
      <p className="hint-text">
        Cross-Emitter labels for categorizing Sources (e.g. "CED", "Intercepts"). Open a group to see which Emitters
        its Sources sit under and when each Source was last updated; query to find what&apos;s out of date.
      </p>

      {showForm && <SourceGroupForm onClose={() => setShowForm(false)} />}
      {deleteError && <div className="error-text">{deleteError}</div>}

      <section className="card source-query">
        <div className="source-query-fields">
          <label className="grow">
            Search
            <input
              type="search"
              placeholder="Source, Emitter, designation, group or type"
              value={query.text}
              onChange={(e) => set("text", e.target.value)}
            />
          </label>
          <label>
            Last updated from
            <input type="date" value={query.from} onChange={(e) => set("from", e.target.value)} />
          </label>
          <label>
            to
            <input type="date" value={query.to} onChange={(e) => set("to", e.target.value)} />
          </label>
          <label>
            Not updated in
            <select
              value=""
              onChange={(e) => {
                if (e.target.value) setQuery((q) => ({ ...q, from: "", to: monthsAgo(Number(e.target.value)) }));
              }}
            >
              <option value="">Pick…</option>
              <option value="6">6 months</option>
              <option value="12">1 year</option>
              <option value="24">2 years</option>
              <option value="60">5 years</option>
            </select>
          </label>
          <label>
            Status
            <select value={query.status} onChange={(e) => set("status", e.target.value)}>
              <option value="">Any</option>
              <option value="approved">Approved</option>
              <option value="pending_review">Pending review</option>
              <option value="rejected">Rejected</option>
            </select>
          </label>
          {types.length > 0 && (
            <label>
              Type
              <select value={query.type} onChange={(e) => set("type", e.target.value)}>
                <option value="">Any</option>
                {types.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="inline-label">
            <input type="checkbox" checked={query.ungrouped} onChange={(e) => set("ungrouped", e.target.checked)} />
            Include Sources with no group
          </label>
          {querying && (
            <button type="button" className="link-button" onClick={() => setQuery(NO_QUERY)}>
              Clear
            </button>
          )}
        </div>
        <div className="source-query-summary">
          <span>
            <strong>{matching.length.toLocaleString()}</strong> Source{matching.length === 1 ? "" : "s"} on {emitterCount}{" "}
            Emitter{emitterCount === 1 ? "" : "s"}
            {total.oldest && (
              <span className="hint-text">
                {" "}
                · last updated between {total.oldest} and {total.newest}
              </span>
            )}
          </span>
          <span className="section-actions">
            {view === "tree" && (
              <>
                <button type="button" className="link-button" onClick={expandAll}>
                  Expand all
                </button>
                <button type="button" className="link-button" onClick={() => setExpanded(new Set())}>
                  Collapse all
                </button>
              </>
            )}
            <span className="theme-toggle" role="group" aria-label="View">
              <button type="button" aria-pressed={view === "tree"} className={view === "tree" ? "active" : ""} onClick={() => setView("tree")}>
                Tree
              </button>
              <button type="button" aria-pressed={view === "list"} className={view === "list" ? "active" : ""} onClick={() => setView("list")}>
                List
              </button>
            </span>
          </span>
        </div>
      </section>

      {isLoading || overviewLoading ? (
        <LoadingState label="Loading source groups…" />
      ) : sourceGroups.length === 0 && (overview ?? []).length === 0 ? (
        <EmptyState
          icon="◇"
          title="No Source Groups yet"
          message="Create a group to start categorizing Sources across Emitters, or import a document — each import creates its own group automatically."
        />
      ) : view === "list" ? (
        <section className="card">
          {matching.length === 0 ? <p className="hint-text">No Sources match.</p> : <SourceList sources={matching} />}
        </section>
      ) : (
        <section className="card">
          {groupRows.length === 0 ? (
            <p className="hint-text">No Sources match.</p>
          ) : (
            <table className="data-table source-tree-table">
              <thead>
                <tr>
                  <th>Group / Emitter / Source</th>
                  <th>Sources</th>
                  <th>Oldest update</th>
                  <th>Newest update</th>
                  <th>Last edited</th>
                  <th>RF (engineered)</th>
                  <th>PW (engineered)</th>
                  <th>PRI (engineered, fixed only)</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {groupRows.map(({ id, group: g }) => {
                  if (g && editingId === g.id) return <EditGroupRow key={id} group={g} onDone={() => setEditingId(null)} />;
                  const emitters = tree.get(id) ?? new Map<string, SourceOverview[]>();
                  const groupSources = [...emitters.values()].flat();
                  const groupSpan = span(groupSources);
                  const open = isOpen(id);
                  return (
                    <Fragment key={id}>
                      <tr className="tree-row tree-group">
                        <td>
                          <button
                            type="button"
                            className="tree-toggle"
                            aria-expanded={open}
                            disabled={groupSources.length === 0}
                            onClick={() => toggle(id)}
                          >
                            {groupSources.length === 0 ? "·" : open ? "▾" : "▸"}
                          </button>
                          <strong>{g ? g.name : "No group"}</strong>
                          {g?.description && <div className="hint-text cell-subline">{g.description}</div>}
                          <div className="hint-text cell-subline">
                            {emitters.size} Emitter{emitters.size === 1 ? "" : "s"}
                          </div>
                        </td>
                        <td>
                          {groupSources.length}
                          {g && querying && g.source_count !== groupSources.length && (
                            <span className="hint-text"> of {g.source_count}</span>
                          )}
                          {g && !querying && g.source_count > groupSources.length && (
                            <div className="hint-text cell-subline">
                              + {g.source_count - groupSources.length} on deleted Emitters (still in the ranges)
                            </div>
                          )}
                        </td>
                        <td>
                          <DateCell day={groupSpan.oldest} />
                        </td>
                        <td>
                          <DateCell day={groupSpan.newest} />
                        </td>
                        <td>{groupSpan.edited ? new Date(groupSpan.edited).toLocaleDateString() : "—"}</td>
                        <td>{g ? rangeText(g.rf_min_mhz, g.rf_max_mhz, "MHz") : "—"}</td>
                        <td>{g ? rangeText(g.pw_min_us, g.pw_max_us, "µs") : "—"}</td>
                        <td>
                          {g ? rangeText(g.pri_min_us, g.pri_max_us, "µs") : "—"}
                          {g && g.pri_stagger_count > 0 && (
                            <div className="hint-text">+ {g.pri_stagger_count} stagger element(s) excluded from this range</div>
                          )}
                        </td>
                        <td>
                          {g && (
                            <RequireRole minimum="admin">
                              <button className="link-button" onClick={() => setEditingId(g.id)}>
                                Edit
                              </button>{" "}
                              <button className="link-button link-button-danger" onClick={() => void handleDelete(g)}>
                                Delete
                              </button>
                            </RequireRole>
                          )}
                        </td>
                      </tr>
                      {open &&
                        [...emitters.entries()].map(([emitterId, sources]) => {
                          const key = `${id}/${emitterId}`;
                          const emitterOpen = isOpen(key);
                          const s0 = sources[0];
                          const emitterSpan = span(sources);
                          return (
                            <Fragment key={key}>
                              <tr className="tree-row tree-emitter">
                                <td>
                                  <button type="button" className="tree-toggle" aria-expanded={emitterOpen} onClick={() => toggle(key)}>
                                    {emitterOpen ? "▾" : "▸"}
                                  </button>
                                  <Link to={`/emitters/${emitterId}`}>{s0.emitter_name}</Link>
                                  {s0.emitter_designation && <span className="hint-text"> ({s0.emitter_designation})</span>}
                                </td>
                                <td>{sources.length}</td>
                                <td>
                                  <DateCell day={emitterSpan.oldest} />
                                </td>
                                <td>
                                  <DateCell day={emitterSpan.newest} />
                                </td>
                                <td>{emitterSpan.edited ? new Date(emitterSpan.edited).toLocaleDateString() : "—"}</td>
                                <td colSpan={4} />
                              </tr>
                              {emitterOpen &&
                                sources.map((s) => (
                                  <tr key={s.id} className="tree-row tree-source">
                                    <td>
                                      <Link to={sourceLink(s)}>{s.name}</Link>
                                      {s.status !== "approved" && (
                                        <span className={`status-badge status-${s.status}`}>{s.status.replace("_", " ")}</span>
                                      )}
                                      <div className="hint-text cell-subline">
                                        {[s.source_type, `${s.element_count} elements`, `${s.sequence_count} sequences`, `${s.mode_count} Modes`]
                                          .filter(Boolean)
                                          .join(" · ")}
                                      </div>
                                    </td>
                                    <td />
                                    <td colSpan={2}>
                                      <DateCell day={s.source_date} />
                                    </td>
                                    <td>{new Date(s.updated_at).toLocaleDateString()}</td>
                                    <td colSpan={4} />
                                  </tr>
                                ))}
                            </Fragment>
                          );
                        })}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
      )}
      {dialog}
    </div>
  );
}
