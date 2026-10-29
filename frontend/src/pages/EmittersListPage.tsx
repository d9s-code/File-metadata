import { Fragment, useCallback, useState, type FormEvent } from "react";
import { EMITTERS_SECTION, InfoTip, PageHeader } from "../components/common/PageHeader";
import { MenuButton } from "../components/common/MenuButton";
import { FilterBar, shownCount } from "../components/common/FilterBar";
import { useColumnVisibility, useColumnVisibilityMenu, type ToggleableColumn } from "../components/common/ColumnVisibilityMenu";
import { Link, useNavigate } from "react-router-dom";
import { useCreateEmitter, useDeleteEmitter, useEmitters } from "../state/hooks/useEmitters";
import { RequireRole } from "../auth/RequireAuth";
import { ApiRequestError } from "../api/client";
import { LoadingState } from "../components/common/LoadingState";
import { EmptyState } from "../components/common/EmptyState";
import { Modal } from "../components/common/Modal";
import { useConfirmDialog } from "../components/common/ConfirmDialog";
import { SortableColumnHeader } from "../components/common/SortableColumnHeader";
import { useSortableTable } from "../components/common/useSortableTable";
import { compareNullable, compareStrings } from "../components/common/sortUtils";
import type { Emitter } from "../types/domain";
import { useAuth } from "../auth/AuthContext";
import { usePeople, useTasks } from "../state/hooks/useTasks";
import { TasksButton } from "../components/tasks/TasksButton";
import { EmitterBulkBar } from "../components/emitters/EmitterBulkBar";
import { useHasRole } from "../auth/RequireAuth";
import { StatusBadge } from "../components/status/StatusBadge";
import { useStatuses } from "../state/hooks/useStatuses";
import { useSessionState } from "../components/common/useSessionState";

type EmitterSortKey =
  | "name"
  | "designation"
  | "status"
  | "rf_min"
  | "rf_max"
  | "pw_min"
  | "pw_max"
  | "pri_min"
  | "pri_max"
  | "scan_min"
  | "scan_max"
  | "sim_correct"
  | "assignee"
  | "platforms";

function platformNames(e: Emitter): string {
  return (e.platforms ?? []).map((p) => p.name).join(", ");
}

/** Share of SIM Test Lines correct in their latest run; null without lines. */
function simShare(e: Emitter): number | null {
  return e.summary.sim_lines ? e.summary.sim_lines_correct / e.summary.sim_lines : null;
}

/** `statusLabel` gives a status's name as shown, so Status sorts A–Z by it. */
function compareEmitters(
  a: Emitter,
  b: Emitter,
  key: EmitterSortKey,
  dir: "asc" | "desc",
  statusLabel: (key: string) => string,
): number {
  switch (key) {
    case "name":
      return compareStrings(a.name, b.name, dir);
    case "designation":
      return compareStrings(a.designation, b.designation, dir);
    case "status":
      return compareStrings(statusLabel(a.status), statusLabel(b.status), dir);
    case "rf_min":
      return compareNullable(a.summary.rf_min_mhz, b.summary.rf_min_mhz, dir);
    case "rf_max":
      return compareNullable(a.summary.rf_max_mhz, b.summary.rf_max_mhz, dir);
    case "pw_min":
      return compareNullable(a.summary.pw_min_us, b.summary.pw_min_us, dir);
    case "pw_max":
      return compareNullable(a.summary.pw_max_us, b.summary.pw_max_us, dir);
    case "pri_min":
      return compareNullable(a.summary.pri_min_us, b.summary.pri_min_us, dir);
    case "pri_max":
      return compareNullable(a.summary.pri_max_us, b.summary.pri_max_us, dir);
    case "scan_min":
      return compareNullable(a.summary.scan_min, b.summary.scan_min, dir);
    case "scan_max":
      return compareNullable(a.summary.scan_max, b.summary.scan_max, dir);
    case "sim_correct":
      return compareNullable(simShare(a), simShare(b), dir);
    case "assignee":
      return compareStrings(a.assignee_username, b.assignee_username, dir);
    case "platforms":
      return compareStrings(platformNames(a) || null, platformNames(b) || null, dir);
  }
}

type ColumnId = "designation" | "status" | "assignee" | "platforms" | "rf" | "pri" | "pw" | "scan" | "sim" | "tasks";
const COLUMNS: ToggleableColumn<ColumnId>[] = [
  { id: "designation", label: "Designation" },
  { id: "status", label: "Status" },
  { id: "assignee", label: "Assigned to" },
  { id: "platforms", label: "Platforms" },
  { id: "rf", label: "RF (MHz)" },
  { id: "pri", label: "PRI (µs)" },
  { id: "pw", label: "PW (µs)" },
  { id: "scan", label: "Scan", defaultHidden: true },
  { id: "sim", label: "SIM correct" },
  { id: "tasks", label: "Tasks" },
];

/** No filter applied when both ends are blank. Otherwise an Emitter matches
 * only if it actually has data for this parameter AND that data's range
 * overlaps the filter range at all. */
function rangeOverlaps(filterMin: string, filterMax: string, valueMin: number | null, valueMax: number | null): boolean {
  if (!filterMin && !filterMax) return true;
  if (valueMin == null || valueMax == null) return false;
  const fMin = filterMin ? Number(filterMin) : -Infinity;
  const fMax = filterMax ? Number(filterMax) : Infinity;
  return valueMin <= fMax && valueMax >= fMin;
}

export function EmittersListPage() {
  const { data: emitters, isLoading, error } = useEmitters();
  // Open tasks about each Emitter, counted once for the whole list.
  const { data: emitterTasks } = useTasks({ entity_type: "emitter", state: "open" });
  const openTasks = new Map<string, number>();
  for (const t of emitterTasks ?? []) if (t.entity_id) openTasks.set(t.entity_id, (openTasks.get(t.entity_id) ?? 0) + 1);
  const createEmitter = useCreateEmitter();
  const deleteEmitter = useDeleteEmitter();
  const { confirmDelete, dialog } = useConfirmDialog();
  const navigate = useNavigate();
  const [showAddModal, setShowAddModal] = useState(false);
  const [name, setName] = useState("");
  const [designation, setDesignation] = useState("");
  const [description, setDescription] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Matches the name or the designation.
  const [nameFilter, setNameFilter] = useSessionState("emitters.nameFilter", "");
  const [showRanges, setShowRanges] = useSessionState("emitters.showRanges", false);
  const [rfMin, setRfMin] = useSessionState("emitters.rfMin", "");
  const [rfMax, setRfMax] = useSessionState("emitters.rfMax", "");
  const [pwMin, setPwMin] = useSessionState("emitters.pwMin", "");
  const [pwMax, setPwMax] = useSessionState("emitters.pwMax", "");
  const [priMin, setPriMin] = useSessionState("emitters.priMin", "");
  const [priMax, setPriMax] = useSessionState("emitters.priMax", "");
  const [scanMin, setScanMin] = useSessionState("emitters.scanMin", "");
  const [scanMax, setScanMax] = useSessionState("emitters.scanMax", "");
  // Matches a Platform the Emitter is pinned on; "none" (or "—") those on none.
  const [platformFilter, setPlatformFilter] = useSessionState("emitters.platformFilter", "");
  // "" anyone, "me", "none", or a person's id.
  const [assignedFilter, setAssignedFilter] = useSessionState("emitters.assignedFilter", "");
  const { user } = useAuth();
  const { data: people } = usePeople();
  const canWrite = useHasRole("editor");
  // Emitters ticked for a bulk action.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const filtered = (emitters ?? []).filter((e) => {
    const nameQ = nameFilter.trim().toLowerCase();
    if (nameQ && !`${e.name} ${e.designation ?? ""}`.toLowerCase().includes(nameQ)) return false;
    const platformQ = platformFilter.trim().toLowerCase();
    if (platformQ === "none" || platformQ === "—") {
      if ((e.platforms ?? []).length) return false;
    } else if (platformQ && !(e.platforms ?? []).some((p) => p.name.toLowerCase().includes(platformQ))) return false;
    if (!rangeOverlaps(rfMin, rfMax, e.summary.rf_min_mhz, e.summary.rf_max_mhz)) return false;
    if (!rangeOverlaps(pwMin, pwMax, e.summary.pw_min_us, e.summary.pw_max_us)) return false;
    if (!rangeOverlaps(priMin, priMax, e.summary.pri_min_us, e.summary.pri_max_us)) return false;
    if (!rangeOverlaps(scanMin, scanMax, e.summary.scan_min, e.summary.scan_max)) return false;
    if (assignedFilter === "none" && e.assignee_id) return false;
    if (assignedFilter === "me" && e.assignee_id !== user?.id) return false;
    if (assignedFilter && !["me", "none"].includes(assignedFilter) && e.assignee_id !== assignedFilter) return false;
    return true;
  });

  const statuses = useStatuses("emitter");
  const comparator = useCallback(
    (a: Emitter, b: Emitter, key: EmitterSortKey, dir: "asc" | "desc") => compareEmitters(a, b, key, dir, statuses.label),
    [statuses],
  );
  // Z–A by name until someone sorts it otherwise (kept for the tab's session).
  const { sorted, sortKey, sortDir, onSort, onClear } = useSortableTable<Emitter, EmitterSortKey>(filtered, comparator, "emitters", {
    key: "name",
    dir: "desc",
  });
  const columns = useColumnVisibility("emitters-list-columns", COLUMNS);
  const columnMenu = useColumnVisibilityMenu(columns);
  const show = columns.isVisible;

  // Two header rows: each range's min and max under one group label; every
  // other column spans both.
  const header = (
    label: string,
    key: EmitterSortKey,
    columnType?: "string" | "number" | "date",
    opts: { rowSpan?: number; className?: string; title?: string } = { rowSpan: 2 },
  ) => (
    <SortableColumnHeader
      label={label}
      columnKey={key}
      columnType={columnType}
      activeKey={sortKey}
      activeDir={sortDir}
      onSort={onSort}
      onClear={onClear}
      {...opts}
    />
  );
  const RANGES = (
    [
      ["rf", "RF", "MHz", "rf_min", "rf_max"],
      ["pri", "PRI", "µs", "pri_min", "pri_max"],
      ["pw", "PW", "µs", "pw_min", "pw_max"],
      ["scan", "Scan", "s", "scan_min", "scan_max"],
    ] as const
  ).filter(([id]) => show(id));
  const summaryOf = (e: Emitter, id: (typeof RANGES)[number][0]): [number | null, number | null] =>
    id === "rf"
      ? [e.summary.rf_min_mhz, e.summary.rf_max_mhz]
      : id === "pri"
        ? [e.summary.pri_min_us, e.summary.pri_max_us]
        : id === "pw"
          ? [e.summary.pw_min_us, e.summary.pw_max_us]
          : [e.summary.scan_min, e.summary.scan_max];

  const rangesSet = [rfMin, rfMax, pwMin, pwMax, priMin, priMax, scanMin, scanMax].some(Boolean);
  const filtering = !!nameFilter || !!platformFilter || !!assignedFilter || rangesSet;
  // Every Platform some Emitter is on, for the Platform search's suggestions.
  const platformOptions = [...new Set((emitters ?? []).flatMap((e) => (e.platforms ?? []).map((p) => p.name)))].sort(
    (a, b) => a.localeCompare(b),
  );

  function resetFilters() {
    setNameFilter("");
    setPlatformFilter("");
    setRfMin("");
    setRfMax("");
    setPwMin("");
    setPwMax("");
    setPriMin("");
    setPriMax("");
    setScanMin("");
    setScanMax("");
    setAssignedFilter("");
  }

  async function handleDelete(emitter: Emitter) {
    setDeleteError(null);
    if (await confirmDelete(`Delete Emitter "${emitter.name}"? It can be restored from Recently Deleted for 30 days.`)) {
      try {
        await deleteEmitter.mutateAsync({ id: emitter.id });
      } catch (err) {
        setDeleteError(err instanceof ApiRequestError ? err.message : "Failed to delete emitter");
      }
    }
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    try {
      const emitter = await createEmitter.mutateAsync({
        name,
        designation: designation || undefined,
        description: description || undefined,
      });
      setName("");
      setDesignation("");
      setDescription("");
      setShowAddModal(false);
      navigate(`/emitters/${emitter.id}`);
    } catch (err) {
      setFormError(err instanceof ApiRequestError ? err.message : "Failed to create emitter");
    }
  }

  return (
    <div className={canWrite && selected.size > 0 ? "page emitters-page-bulk" : "page"}>
      <PageHeader
        title="Emitters"
        info="Every Emitter: its EW Groups, Sources and Modes, its tests and where it's pinned. Tick rows for actions on several at once."
        section={EMITTERS_SECTION}
      >
        <RequireRole minimum="editor">
          <button onClick={() => setShowAddModal(true)}>+ Add Emitter</button>
        </RequireRole>
      </PageHeader>

      {showAddModal && (
        <Modal title="Add Emitter" onClose={() => setShowAddModal(false)}>
          <form onSubmit={handleCreate}>
            <div className="form-row">
              <label className="wide-label">
                Name
                <input value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
              </label>
            </div>
            <div className="form-row">
              <label className="wide-label">
                Designation (optional)
                <input value={designation} onChange={(e) => setDesignation(e.target.value)} />
              </label>
            </div>
            <div className="form-row">
              <label className="wide-label">
                Description (optional)
                <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
              </label>
            </div>
            {formError && <div className="error-text">{formError}</div>}
            <div className="modal-actions">
              <button type="button" className="button secondary" onClick={() => setShowAddModal(false)}>
                Cancel
              </button>
              <button type="submit" className="button primary" disabled={createEmitter.isPending}>
                Add Emitter
              </button>
            </div>
          </form>
        </Modal>
      )}

      {error && <div className="error-text">{(error as Error).message}</div>}
      {deleteError && <div className="error-text">{deleteError}</div>}

      <FilterBar
        active={filtering}
        onReset={resetFilters}
        count={emitters ? shownCount(sorted.length, emitters.length, "Emitter") : null}
        end={
          <button type="button" className="button secondary small" onClick={columnMenu.openFrom}>
            Columns ▾
          </button>
        }
      >
        <input
          type="search"
          className="filter-search-wide"
          placeholder="Name or designation…"
          aria-label="Filter by name or designation"
          value={nameFilter}
          onChange={(e) => setNameFilter(e.target.value)}
        />
        <input
          type="search"
          placeholder="Platform…"
          aria-label="Filter by Platform"
          title='Emitters pinned on a Platform whose name contains this; "none" for those on no Platform'
          list="emitters-platform-options"
          value={platformFilter}
          onChange={(e) => setPlatformFilter(e.target.value)}
        />
        <datalist id="emitters-platform-options">
          {platformOptions.map((n) => (
            <option key={n} value={n} />
          ))}
          <option value="none">On no Platform</option>
        </datalist>
        <select aria-label="Assigned to" value={assignedFilter} onChange={(e) => setAssignedFilter(e.target.value)}>
          <option value="">Assigned to anyone</option>
          <option value="me">Assigned to me</option>
          <option value="none">Assigned to nobody</option>
          {(people ?? [])
            .filter((p) => p.role !== "viewer" && p.id !== user?.id)
            .map((p) => (
              <option key={p.id} value={p.id}>
                Assigned to {p.username}
              </option>
            ))}
        </select>
        <button
          type="button"
          className={rangesSet ? "button secondary small filter-toggle active" : "button secondary small filter-toggle"}
          aria-expanded={showRanges || rangesSet}
          onClick={() => setShowRanges((v) => !v)}
        >
          RF / PRI / PW / Scan {showRanges || rangesSet ? "▴" : "▾"}
        </button>
      </FilterBar>
      {(showRanges || rangesSet) && (
        <div className="filter-bar filter-bar-ranges">
          {(
            [
              ["RF (MHz)", rfMin, setRfMin, rfMax, setRfMax],
              ["PRI (µs)", priMin, setPriMin, priMax, setPriMax],
              ["PW (µs)", pwMin, setPwMin, pwMax, setPwMax],
              ["Scan", scanMin, setScanMin, scanMax, setScanMax],
            ] as const
          ).map(([label, min, setMin, max, setMax]) => (
            <label key={label} className="range-filter">
              <span className="range-filter-label">{label}</span>
              <input type="number" step="any" placeholder="min" aria-label={`${label} min`} value={min} onChange={(e) => setMin(e.target.value)} />
              <span aria-hidden="true">–</span>
              <input type="number" step="any" placeholder="max" aria-label={`${label} max`} value={max} onChange={(e) => setMax(e.target.value)} />
            </label>
          ))}
          <InfoTip label="How the range filters match">
            RF, PRI and PW match an Emitter if any of its approved Modes falls within the range. Scan matches against
            the Emitter&apos;s EW Groups.
          </InfoTip>
        </div>
      )}

      {isLoading ? (
        <LoadingState label="Loading emitters…" />
      ) : (emitters ?? []).length === 0 ? (
        <EmptyState
          icon="◇"
          title="No Emitters yet"
          message="Add one with + Add Emitter, then build its EW Groups, Sources and Modes."
        />
      ) : sorted.length === 0 ? (
        <EmptyState icon="◇" title="No matches" message="No Emitters match the current search/filters." />
      ) : (
        <>
        {canWrite && selected.size > 0 && (
          <EmitterBulkBar selected={[...selected]} onClear={() => setSelected(new Set())} />
        )}
        <div className="matrix-scroll">
        <table className="data-table emitters-table">
          <thead>
            <tr {...columnMenu.openProps}>
              {canWrite && (
                <th className="select-col" rowSpan={2}>
                  <input
                    type="checkbox"
                    aria-label="Select all shown"
                    checked={sorted.length > 0 && sorted.every((e) => selected.has(e.id))}
                    onChange={(ev) =>
                      setSelected(ev.target.checked ? new Set([...selected, ...sorted.map((e) => e.id)]) : new Set())
                    }
                  />
                </th>
              )}
              {show("designation") && header("Designation", "designation")}
              {header("Name", "name", undefined, { rowSpan: 2, className: "emitters-name-col" })}
              {show("status") && header("Status", "status")}
              {show("assignee") && header("Assigned to", "assignee")}
              {show("platforms") && header("Platforms", "platforms")}
              {RANGES.map(([id, label, unit]) => (
                <th key={id} colSpan={2} className="range-group">
                  {label} <span className="range-unit">({unit})</span>
                </th>
              ))}
              {show("sim") && header("SIM correct", "sim_correct", "number")}
              {show("tasks") && <th rowSpan={2}>Tasks</th>}
              <th className="row-actions" aria-label="Actions" rowSpan={2}></th>
            </tr>
            {RANGES.length > 0 && (
              <tr {...columnMenu.openProps}>
                {RANGES.map(([id, label, unit, minKey, maxKey]) => (
                  <Fragment key={id}>
                    {header("min", minKey, "number", { className: "num range-start", title: `Lowest ${label} (${unit})` })}
                    {header("max", maxKey, "number", { className: "num", title: `Highest ${label} (${unit})` })}
                  </Fragment>
                ))}
              </tr>
            )}
          </thead>
          <tbody>
            {sorted.map((e) => (
              <tr key={e.id} className={selected.has(e.id) ? "selected-row" : undefined}>
                {canWrite && (
                  <td className="select-col">
                    <input
                      type="checkbox"
                      aria-label={`Select ${e.name}`}
                      checked={selected.has(e.id)}
                      onChange={() => toggle(e.id)}
                    />
                  </td>
                )}
                {show("designation") && <td>{e.designation ?? "—"}</td>}
                <td className="emitters-name-col">
                  <Link to={`/emitters/${e.id}`}>{e.name}</Link>
                </td>
                {show("status") && (
                  <td>
                    <StatusBadge type="emitter" status={e.status} />
                  </td>
                )}
                {show("assignee") && (
                  <td>{e.assignee_id === user?.id ? <strong>You</strong> : (e.assignee_username ?? <span className="muted">—</span>)}</td>
                )}
                {show("platforms") && (
                  <td className="emitters-platforms-col">
                    {(e.platforms ?? []).length === 0 ? (
                      <span className="muted">—</span>
                    ) : (
                      e.platforms.map((p, i) => (
                        <Fragment key={p.id}>
                          {i > 0 && ", "}
                          <Link to={`/platforms/${p.id}`}>{p.name}</Link>
                        </Fragment>
                      ))
                    )}
                  </td>
                )}
                {RANGES.flatMap(([id]) => {
                  const [min, max] = summaryOf(e, id);
                  return [
                    <td key={`${id}-min`} className="num range-start">
                      {min ?? "—"}
                    </td>,
                    <td key={`${id}-max`} className="num">
                      {max ?? "—"}
                    </td>,
                  ];
                })}
                {show("sim") && (
                  <td
                    className="nowrap"
                    title={
                      e.summary.sim_lines
                        ? `${e.summary.sim_lines_correct} of ${e.summary.sim_lines} SIM Test Lines correct in their latest run` +
                          (e.summary.sim_lines_outdated
                            ? ` · ${e.summary.sim_lines_outdated} out of date (tested against Modes since deleted)`
                            : "")
                        : "No SIM Test Lines"
                    }
                  >
                    {e.summary.sim_lines ? `${e.summary.sim_lines_correct} / ${e.summary.sim_lines}` : "—"}
                    {e.summary.sim_lines_outdated > 0 && <span className="summary-bad"> · {e.summary.sim_lines_outdated} out of date</span>}
                  </td>
                )}
                {show("tasks") && (
                  <td>
                    <TasksButton type="emitter" id={e.id} name={e.name} openCount={openTasks.get(e.id) ?? 0} compact />
                  </td>
                )}
                <td className="row-actions">
                  <MenuButton
                    label="⋯"
                    className="row-menu-button"
                    ariaLabel={`Actions for ${e.name}`}
                    items={[
                      { label: "Compare with another Emitter", to: `/emitters/compare?a=${e.id}` },
                      ...(canWrite ? [{ label: "Delete…", danger: true, onSelect: () => void handleDelete(e) }] : []),
                    ]}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
        </>
      )}
      {columnMenu.menu}
      {dialog}
    </div>
  );
}
