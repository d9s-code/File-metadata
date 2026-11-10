import { Fragment, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiRequestError } from "../../api/client";
import { emittersApi } from "../../api/emitters";
import { emitterVersionsApi } from "../../api/emitterVersions";
import { threatPrioritiesApi, type ThreatPriorityRow } from "../../api/threatPriorities";
import type { Allegiance } from "../../api/platforms";
import { useAuth } from "../../auth/AuthContext";
import { useHasRole } from "../../auth/RequireAuth";
import { useSessionState } from "../common/useSessionState";
import { FilterBar, shownCount } from "../common/FilterBar";
import { LoadingState } from "../common/LoadingState";
import { EmptyState } from "../common/EmptyState";
import { Modal } from "../common/Modal";
import { compareNullable, compareStrings } from "../common/sortUtils";
import { SortableColumnHeader } from "../common/SortableColumnHeader";
import { ALLEGIANCES, AllegianceChip, allegianceLabel } from "../platform/platformTraits";
import { StatusBadge } from "../status/StatusBadge";

const KEY = ["threat-priorities"] as const;

type GroupBy = "none" | "emitter" | "priority" | "platform" | "allegiance";
type SortKey = "emitter" | "group" | "priority" | "modes" | "platforms";

const GROUP_BY: { key: GroupBy; label: string }[] = [
  { key: "none", label: "No grouping" },
  { key: "priority", label: "Threat priority" },
  { key: "emitter", label: "Emitter" },
  { key: "platform", label: "Platform" },
  { key: "allegiance", label: "Allegiance" },
];

/** Every key a row is filed under for a grouping — a row on two Platforms is in both. */
function groupKeys(r: ThreatPriorityRow, by: GroupBy): { key: string; label: string; order: string }[] {
  switch (by) {
    case "none":
      return [{ key: "all", label: "", order: "" }];
    case "emitter":
      return [{ key: r.emitter_id, label: r.designation ? `${r.designation} — ${r.emitter_name}` : r.emitter_name, order: r.emitter_name.toLowerCase() }];
    case "priority":
      return r.threat_priority == null
        ? [{ key: "none", label: "No threat priority", order: "~" }]
        : [{ key: String(r.threat_priority), label: `Threat priority ${r.threat_priority}`, order: String(r.threat_priority).padStart(9, "0") }];
    case "platform":
      return r.platforms.length
        ? r.platforms.map((p) => ({ key: p.id, label: p.name, order: p.name.toLowerCase() }))
        : [{ key: "none", label: "On no Platform", order: "~" }];
    case "allegiance": {
      const set = [...new Set(r.platforms.map((p) => p.allegiance ?? "unknown"))];
      const keys = set.length ? set : ["none"];
      const order = (a: string) => ({ hostile: "1", neutral: "2", friendly: "3", unknown: "4", none: "5" })[a] ?? "9";
      return keys.map((a) => ({
        key: a,
        label: a === "none" ? "On no Platform" : a === "unknown" ? "On a Platform of unknown allegiance" : `On a ${allegianceLabel(a as Allegiance).toLowerCase()} Platform`,
        order: order(a),
      }));
    }
  }
}

/** One threat priority cell: type a number, Enter or leaving the cell saves it; empty clears it. */
function PriorityCell({
  row,
  disabled,
  title,
  onSave,
}: {
  row: ThreatPriorityRow;
  disabled: boolean;
  title?: string;
  onSave: (v: number | null) => void;
}) {
  const [text, setText] = useState<string | null>(null);
  const shown = text ?? (row.threat_priority == null ? "" : String(row.threat_priority));
  const commit = () => {
    if (text == null) return;
    const t = text.trim();
    const v = t === "" ? null : Number(t);
    setText(null);
    if (v !== null && (!Number.isInteger(v) || v < 0)) return;
    if (v !== row.threat_priority) onSave(v);
  };
  return (
    <input
      className="tp-input"
      type="number"
      min={0}
      step={1}
      inputMode="numeric"
      value={shown}
      placeholder="—"
      disabled={disabled}
      title={title}
      aria-label={`Threat priority of ${row.emitter_name} › ${row.ew_group_name}`}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") {
          setText(null);
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}

/** Threat priorities across every Emitter — one row per EW Group, where the
 * priority lives — editable in place or in bulk, filtered, sorted and grouped
 * by priority, Emitter, Platform or the Platforms' allegiance. */
export function ThreatPriorities() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const canWrite = useHasRole("editor");
  const { data: rows, isLoading, error } = useQuery({ queryKey: KEY, queryFn: threatPrioritiesApi.list });
  const [search, setSearch] = useSessionState("threat.search", "");
  const [groupBy, setGroupBy] = useSessionState<GroupBy>("threat.groupBy", "priority");
  const [only, setOnly] = useSessionState<"" | "set" | "unset">("threat.only", "");
  const [allegiance, setAllegiance] = useSessionState<"" | Allegiance | "unknown">("threat.allegiance", "");
  const [sort, setSort] = useSessionState<{ key: SortKey; dir: "asc" | "desc" }>("threat.sort", { key: "emitter", dir: "asc" });
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  const change = useMutation({
    mutationFn: threatPrioritiesApi.change,
    onSuccess: (res, changes) => {
      qc.invalidateQueries({ queryKey: KEY });
      qc.invalidateQueries({ queryKey: ["emitters"] });
      qc.invalidateQueries({ queryKey: ["ewGroups"] });
      const ids = new Set(touched);
      for (const c of changes) {
        const r = rows?.find((x) => x.ew_group_id === c.ew_group_id);
        if (r) ids.add(r.emitter_id);
      }
      setTouched(ids);
      setProblem(null);
      setMessage(
        `${res.updated} changed${res.unchanged ? `, ${res.unchanged} already so` : ""}.` +
          (res.started_editing.length ? ` Now editing: ${res.started_editing.join(", ")}.` : ""),
      );
    },
    onError: (err) => {
      setMessage(null);
      setProblem(err instanceof ApiRequestError ? err.message : "Couldn't change them");
    },
  });

  const filtered = useMemo(() => {
    const t = search.trim().toLowerCase();
    return (rows ?? []).filter((r) => {
      if (only === "set" && r.threat_priority == null) return false;
      if (only === "unset" && r.threat_priority != null) return false;
      if (allegiance && !r.platforms.some((p) => (p.allegiance ?? "unknown") === allegiance)) return false;
      if (!t) return true;
      return (
        r.emitter_name.toLowerCase().includes(t) ||
        (r.designation ?? "").toLowerCase().includes(t) ||
        r.ew_group_name.toLowerCase().includes(t) ||
        r.platforms.some((p) => p.name.toLowerCase().includes(t))
      );
    });
  }, [rows, search, only, allegiance]);

  const sorted = useMemo(() => {
    const d = sort.dir;
    const cmp = (a: ThreatPriorityRow, b: ThreatPriorityRow) => {
      switch (sort.key) {
        case "emitter":
          return compareStrings(a.emitter_name, b.emitter_name, d) || compareStrings(a.ew_group_name, b.ew_group_name, "asc");
        case "group":
          return compareStrings(a.ew_group_name, b.ew_group_name, d);
        case "priority":
          return compareNullable(a.threat_priority, b.threat_priority, d);
        case "modes":
          return compareNullable(a.modes_count, b.modes_count, d);
        case "platforms":
          return compareStrings(a.platforms.map((p) => p.name).join(", ") || null, b.platforms.map((p) => p.name).join(", ") || null, d);
      }
    };
    return [...filtered].sort(cmp);
  }, [filtered, sort]);

  const groups = useMemo(() => {
    const by = new Map<string, { key: string; label: string; order: string; rows: ThreatPriorityRow[] }>();
    for (const r of sorted) {
      for (const k of groupKeys(r, groupBy)) {
        const g = by.get(k.key) ?? { ...k, rows: [] };
        g.rows.push(r);
        by.set(k.key, g);
      }
    }
    // Plain order ("~" — none — after every number and name).
    return [...by.values()].sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0));
  }, [sorted, groupBy]);

  // Emitters you hold among these — the ones whose versions can be saved from here.
  const mine = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of rows ?? []) if (r.checked_out_by_id === user?.id) m.set(r.emitter_id, r.emitter_name);
    return m;
  }, [rows, user?.id]);
  const [saveOpen, setSaveOpen] = useState(false);
  const [summary, setSummary] = useState("Threat priorities");
  const [toSave, setToSave] = useState<Set<string>>(new Set());
  const [saveResults, setSaveResults] = useState<string[]>([]);

  if (isLoading) return <LoadingState label="Loading threat priorities…" />;
  if (error) return <p className="error-text">{(error as Error).message}</p>;
  if (!rows?.length) return <EmptyState icon="◇" title="No EW Groups yet" message="Threat priorities are set on each Emitter's EW Groups." />;

  const lockOf = (r: ThreatPriorityRow) =>
    r.checked_out_by_id && r.checked_out_by_id !== user?.id ? `${r.checked_out_by_username ?? "Someone"} is editing ${r.emitter_name}` : null;
  const save = (r: ThreatPriorityRow, v: number | null) => change.mutate([{ ew_group_id: r.ew_group_id, threat_priority: v }]);
  const tickable = sorted.filter((r) => !lockOf(r));
  const allTicked = tickable.length > 0 && tickable.every((r) => ticked.has(r.ew_group_id));
  const header = (label: string, key: SortKey, type: "string" | "number" = "string") => (
    <SortableColumnHeader
      label={label}
      columnKey={key}
      columnType={type}
      className={type === "number" ? "num" : undefined}
      activeKey={sort.key}
      activeDir={sort.dir}
      onSort={(k, dir) => setSort({ key: k, dir })}
      onClear={() => setSort({ key: "emitter", dir: "asc" })}
    />
  );
  const cols = canWrite ? 7 : 6;

  async function saveVersions() {
    setSaving(true);
    const out: string[] = [];
    for (const id of toSave) {
      const name = mine.get(id) ?? id;
      try {
        await emitterVersionsApi.commit(id, summary.trim() || "Threat priorities");
        await emittersApi.checkin(id);
        out.push(`✓ ${name} saved`);
      } catch (err) {
        out.push(`✕ ${name}: ${err instanceof ApiRequestError ? err.message : "couldn't save"}`);
      }
    }
    setSaveResults(out);
    setSaving(false);
    setTouched(new Set());
    qc.invalidateQueries({ queryKey: KEY });
    qc.invalidateQueries({ queryKey: ["emitters"] });
    qc.invalidateQueries({ queryKey: ["emitterVersions"] });
  }

  return (
    <div className="threat-priorities">
      <FilterBar
        active={!!(search || only || allegiance)}
        onReset={() => {
          setSearch("");
          setOnly("");
          setAllegiance("");
        }}
        count={shownCount(sorted.length, rows.length, "EW Group")}
        end={
          <label className="tp-groupby">
            <span className="hint-text">Group by</span>
            <select value={groupBy} onChange={(e) => setGroupBy(e.target.value as GroupBy)}>
              {GROUP_BY.map((g) => (
                <option key={g.key} value={g.key}>
                  {g.label}
                </option>
              ))}
            </select>
          </label>
        }
      >
        <input
          type="search"
          className="filter-search-wide"
          placeholder="Emitter, EW Group or Platform…"
          aria-label="Find an Emitter, EW Group or Platform"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select value={only} onChange={(e) => setOnly(e.target.value as typeof only)} aria-label="Threat priority set or not">
          <option value="">Any threat priority</option>
          <option value="set">With a threat priority</option>
          <option value="unset">Without one</option>
        </select>
        <select value={allegiance} onChange={(e) => setAllegiance(e.target.value as typeof allegiance)} aria-label="Platform allegiance">
          <option value="">Any allegiance</option>
          {ALLEGIANCES.map((a) => (
            <option key={a.key} value={a.key}>
              On a {a.label.toLowerCase()} Platform
            </option>
          ))}
          <option value="unknown">On a Platform of unknown allegiance</option>
        </select>
      </FilterBar>

      {canWrite && mine.size > 0 && (
        <div className="card tp-strip">
          <span>
            You&apos;re editing <strong>{mine.size}</strong> of these Emitter{mine.size === 1 ? "" : "s"}
            {touched.size > 0 && <> ({touched.size} changed here)</>} — the priorities are unsaved changes until a version is saved.
          </span>
          <button
            type="button"
            className="button primary small"
            onClick={() => {
              setToSave(new Set([...mine.keys()].filter((id) => touched.size === 0 || touched.has(id))));
              setSaveResults([]);
              setSaveOpen(true);
            }}
          >
            Save versions…
          </button>
        </div>
      )}

      {canWrite && ticked.size > 0 && (
        <div className="card emitter-bulk-bar tp-bulk" role="region" aria-label="Ticked EW Groups">
          <div className="emitter-bulk-row">
            <strong>{ticked.size} ticked</strong>
            <label className="tp-bulk-set">
              Threat priority
              <input type="number" min={0} step={1} value={bulk} onChange={(e) => setBulk(e.target.value)} placeholder="—" />
            </label>
            <button
              type="button"
              className="button primary"
              disabled={change.isPending || (bulk.trim() !== "" && (!Number.isInteger(Number(bulk)) || Number(bulk) < 0))}
              onClick={() =>
                change.mutate(
                  [...ticked].map((id) => ({ ew_group_id: id, threat_priority: bulk.trim() === "" ? null : Number(bulk) })),
                  { onSuccess: () => setTicked(new Set()) },
                )
              }
              title="Set on every ticked EW Group (empty clears it). Emitters nobody is editing are checked out to you."
            >
              {bulk.trim() === "" ? `Clear on ${ticked.size}` : `Set ${bulk} on ${ticked.size}`}
            </button>
            <button type="button" className="link-button" onClick={() => setTicked(new Set())}>
              Clear selection
            </button>
          </div>
        </div>
      )}

      {message && <p className="success-text tp-message">{message}</p>}
      {problem && (
        <p className="error-text tp-message" role="alert">
          {problem}
        </p>
      )}

      <div className="card table-card">
        <table className="data-table tp-table">
          <thead>
            <tr>
              {canWrite && (
                <th className="row-check">
                  <input
                    type="checkbox"
                    aria-label="Tick every EW Group shown"
                    checked={allTicked}
                    onChange={() => setTicked(allTicked ? new Set() : new Set(tickable.map((r) => r.ew_group_id)))}
                  />
                </th>
              )}
              {header("Emitter", "emitter")}
              {header("EW Group", "group")}
              {header("Threat priority", "priority", "number")}
              {header("Modes", "modes", "number")}
              {header("Platforms", "platforms")}
              <th>Editing</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => {
              const open = !collapsed.has(g.key);
              const priorities = [...new Set(g.rows.map((r) => r.threat_priority))];
              return (
                <Fragment key={g.key}>
                  {groupBy !== "none" && (
                    <tr className="tp-group-row">
                      <td colSpan={cols}>
                        <button
                          type="button"
                          className="tp-group-toggle"
                          aria-expanded={open}
                          onClick={() => {
                            const next = new Set(collapsed);
                            if (open) next.add(g.key);
                            else next.delete(g.key);
                            setCollapsed(next);
                          }}
                        >
                          {open ? "▾" : "▸"} {g.label}
                        </button>
                        <span className="hint-text">
                          {g.rows.length} EW Group{g.rows.length === 1 ? "" : "s"}
                          {groupBy !== "priority" &&
                            ` · priority ${priorities.length === 1 ? (priorities[0] ?? "none") : priorities.filter((p) => p != null).length ? `${Math.min(...priorities.filter((p): p is number => p != null))}–${Math.max(...priorities.filter((p): p is number => p != null))}${priorities.includes(null) ? ", some none" : ""}` : "none"}`}
                        </span>
                        {canWrite && (
                          <button
                            type="button"
                            className="link-button tp-group-tick"
                            onClick={() => setTicked(new Set([...ticked, ...g.rows.filter((r) => !lockOf(r)).map((r) => r.ew_group_id)]))}
                          >
                            Tick these
                          </button>
                        )}
                      </td>
                    </tr>
                  )}
                  {open &&
                    g.rows.map((r) => {
                      const lock = lockOf(r);
                      return (
                        <tr key={`${g.key}-${r.ew_group_id}`} className={ticked.has(r.ew_group_id) ? "selected" : undefined}>
                          {canWrite && (
                            <td className="row-check">
                              <input
                                type="checkbox"
                                aria-label={`Tick ${r.emitter_name} › ${r.ew_group_name}`}
                                disabled={!!lock}
                                checked={ticked.has(r.ew_group_id)}
                                onChange={() => {
                                  const next = new Set(ticked);
                                  if (next.has(r.ew_group_id)) next.delete(r.ew_group_id);
                                  else next.add(r.ew_group_id);
                                  setTicked(next);
                                }}
                              />
                            </td>
                          )}
                          <td>
                            <Link to={`/emitters/${r.emitter_id}?tab=setup`}>
                              {r.designation && <span className="hint-text">{r.designation} · </span>}
                              {r.emitter_name}
                            </Link>{" "}
                            <StatusBadge type="emitter" status={r.emitter_status} />
                          </td>
                          <td>{r.ew_group_name}</td>
                          <td className="num">
                            {canWrite ? (
                              <PriorityCell
                                key={`${r.ew_group_id}:${r.threat_priority}`}
                                row={r}
                                disabled={!!lock || change.isPending}
                                title={lock ?? "Type a number; Enter saves, empty clears. The Emitter is checked out to you if nobody is editing it."}
                                onSave={(v) => save(r, v)}
                              />
                            ) : (
                              (r.threat_priority ?? <span className="hint-text">—</span>)
                            )}
                          </td>
                          <td className="num">{r.modes_count}</td>
                          <td>
                            {r.platforms.length === 0 ? (
                              <span className="hint-text">—</span>
                            ) : (
                              <span className="tp-platforms">
                                {r.platforms.map((p) => (
                                  <span key={p.id} className="tp-platform">
                                    <Link to={`/platforms/${p.id}`}>{p.name}</Link>
                                    {p.allegiance && <AllegianceChip allegiance={p.allegiance} />}
                                  </span>
                                ))}
                              </span>
                            )}
                          </td>
                          <td className="hint-text">
                            {r.checked_out_by_id == null ? "—" : r.checked_out_by_id === user?.id ? "You" : r.checked_out_by_username}
                          </td>
                        </tr>
                      );
                    })}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {saveOpen && (
        <Modal title="Save versions" onClose={() => setSaveOpen(false)}>
          {saveResults.length ? (
            <>
              <ul className="tp-save-results">
                {saveResults.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
              <div className="modal-actions">
                <button type="button" onClick={() => setSaveOpen(false)}>
                  Done
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="hint-text">
                Saves each ticked Emitter as a new version — with <em>all</em> its unsaved changes, not only the priorities —
                and stops editing it, as Save version on its page does.
              </p>
              <ul className="tp-save-list">
                {[...mine.entries()].map(([id, name]) => (
                  <li key={id}>
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={toSave.has(id)}
                        onChange={() => {
                          const next = new Set(toSave);
                          if (next.has(id)) next.delete(id);
                          else next.add(id);
                          setToSave(next);
                        }}
                      />
                      {name} {touched.has(id) && <span className="hint-text">· changed here</span>}
                    </label>
                  </li>
                ))}
              </ul>
              <label className="wide-label">
                What changed
                <input value={summary} onChange={(e) => setSummary(e.target.value)} />
              </label>
              <div className="modal-actions">
                <button type="button" className="button secondary" onClick={() => setSaveOpen(false)}>
                  Cancel
                </button>
                <button type="button" className="button primary" disabled={saving || toSave.size === 0 || !summary.trim()} onClick={() => void saveVersions()}>
                  {saving ? "Saving…" : `Save ${toSave.size} version${toSave.size === 1 ? "" : "s"}`}
                </button>
              </div>
            </>
          )}
        </Modal>
      )}
    </div>
  );
}
