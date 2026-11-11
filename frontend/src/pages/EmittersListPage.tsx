import { Fragment, useCallback, useMemo, useState, type FormEvent } from "react";
import { CheckMenu } from "../components/common/CheckMenu";
import { EMITTERS_SECTION, InfoTip, PageHeader } from "../components/common/PageHeader";
import { MenuButton } from "../components/common/MenuButton";
import { DuplicateEmitterModal } from "../components/emitters/DuplicateEmitterModal";
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
import { useFunctionCodes } from "../state/hooks/useFunctionCodes";
import { functionCodeLabel } from "../api/functionCodes";
import { usePeople, useTasks } from "../state/hooks/useTasks";
import { TasksButton } from "../components/tasks/TasksButton";
import { EmitterBulkBar } from "../components/emitters/EmitterBulkBar";
import { useHasRole } from "../auth/RequireAuth";
import { StatusBadge } from "../components/status/StatusBadge";
import { useStatuses } from "../state/hooks/useStatuses";
import { useLocalState, useSessionState } from "../components/common/useSessionState";
import { formatDate } from "../components/common/dates";
import { exportEmitterXml } from "../components/emitters/exportXml";

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
  | "sim_created"
  | "last_tested"
  | "assignee"
  | "function_code"
  | "platforms";

function platformNames(e: Emitter): string {
  return (e.platforms ?? []).map((p) => p.name).join(", ");
}

/** Share of SIM Test Lines correct in their latest run; null without lines. */
function simShare(e: Emitter): number | null {
  return e.summary.sim_lines ? e.summary.sim_lines_correct / e.summary.sim_lines : null;
}

/** `statusRank` gives a status's place in the Admins' order, so Status sorts
 * along the workflow (In progress → … → Operational), then by name. */
function compareEmitters(
  a: Emitter,
  b: Emitter,
  key: EmitterSortKey,
  dir: "asc" | "desc",
  statusRank: (key: string) => number,
  /** A function code's place in the Admins' order (null: none). */
  codeOrder: (id: string | null) => number | null,
): number {
  switch (key) {
    case "name":
      return compareStrings(a.name, b.name, dir);
    case "designation":
      return compareStrings(a.designation, b.designation, dir);
    case "status":
      return (dir === "asc" ? 1 : -1) * (statusRank(a.status) - statusRank(b.status)) || compareStrings(a.name, b.name, "asc");
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
    case "sim_created":
      return compareStrings(a.sim_created_date, b.sim_created_date, dir);
    case "last_tested":
      return compareStrings(a.last_tested_at, b.last_tested_at, dir);
    case "assignee":
      return compareStrings(a.assignee_username, b.assignee_username, dir);
    case "function_code":
      return compareNullable(codeOrder(a.function_code_id), codeOrder(b.function_code_id), dir);
    case "platforms":
      return compareStrings(platformNames(a) || null, platformNames(b) || null, dir);
  }
}

type ColumnId =
  | "designation"
  | "status"
  | "function_code"
  | "assignee"
  | "platforms"
  | "rf"
  | "pri"
  | "pw"
  | "scan"
  | "sim"
  | "sim_created"
  | "last_tested"
  | "tasks";
const COLUMNS: ToggleableColumn<ColumnId>[] = [
  { id: "designation", label: "Designation" },
  { id: "status", label: "Status" },
  { id: "function_code", label: "Function code" },
  { id: "assignee", label: "Assigned to" },
  { id: "platforms", label: "Platforms" },
  { id: "rf", label: "RF (MHz)" },
  { id: "pri", label: "PRI (µs)" },
  { id: "pw", label: "PW (µs)" },
  { id: "scan", label: "Scan", defaultHidden: true },
  { id: "sim", label: "SIM correct" },
  { id: "sim_created", label: "SIM created" },
  { id: "last_tested", label: "Last tested" },
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
  const [functionCodeId, setFunctionCodeId] = useState("");
  const { data: functionCodes } = useFunctionCodes();
  const codesById = useMemo(() => new Map((functionCodes ?? []).map((c) => [c.id, c])), [functionCodes]);
  // Sorting follows the Admins' order.
  const codeIndex = useMemo(() => new Map((functionCodes ?? []).map((c, i) => [c.id, i])), [functionCodes]);
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
  // A function code's id, or "none" for Emitters without one.
  const [codeFilter, setCodeFilter] = useSessionState("emitters.codeFilter", "");
  // Statuses left out of the list — chosen by right-clicking the Status
  // column, and remembered in this browser.
  const [hiddenStatuses, setHiddenStatuses] = useLocalState<string[]>("emitters.hiddenStatuses", []);
  const [statusMenu, setStatusMenu] = useState<{ x: number; y: number } | null>(null);
  const closeStatusMenu = useCallback(() => setStatusMenu(null), []);
  const { user } = useAuth();
  const { data: people } = usePeople();
  const canWrite = useHasRole("editor");
  const [duplicating, setDuplicating] = useState<{ id: string; name: string } | null>(null);
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
    if (codeFilter && (codeFilter === "none" ? e.function_code_id != null : e.function_code_id !== codeFilter)) return false;
    if (hiddenStatuses.includes(e.status)) return false;
    return true;
  });

  const statuses = useStatuses("emitter");
  const comparator = useCallback(
    (a: Emitter, b: Emitter, key: EmitterSortKey, dir: "asc" | "desc") =>
      compareEmitters(a, b, key, dir, statuses.rank, (id) => (id ? (codeIndex.get(id) ?? null) : null)),
    [statuses, codeIndex],
  );
  // By status, first to last in the Admins' order, until someone sorts it
  // otherwise (kept for the tab's session).
  const { sorted, sortKey, sortDir, onSort, onClear } = useSortableTable<Emitter, EmitterSortKey>(
    filtered,
    comparator,
    "emitters-by-status",
    { key: "status", dir: "asc" },
  );

  // Every status, in order, with how many Emitters have it — the defined
  // ones plus any key an Emitter has that isn't defined any more.
  const statusOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of emitters ?? []) counts.set(e.status, (counts.get(e.status) ?? 0) + 1);
    const keys = [...statuses.list.map((st) => st.key)];
    for (const k of counts.keys()) if (!keys.includes(k)) keys.push(k);
    return keys.map((key) => ({ key, count: counts.get(key) ?? 0 }));
  }, [emitters, statuses]);
  const hiddenShown = hiddenStatuses.filter((k) => statusOptions.some((o) => o.key === k));
  function toggleStatus(key: string) {
    setHiddenStatuses((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }
  const openStatusMenu = (e: { preventDefault: () => void; stopPropagation: () => void; clientX: number; clientY: number }) => {
    e.preventDefault();
    e.stopPropagation();
    setStatusMenu({ x: e.clientX, y: e.clientY });
  };
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
  const filtering = !!nameFilter || !!platformFilter || !!assignedFilter || !!codeFilter || rangesSet || hiddenShown.length > 0;
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
    setCodeFilter("");
    setHiddenStatuses([]);
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
    if (!functionCodeId) {
      setFormError("Pick its function code.");
      return;
    }
    try {
      const emitter = await createEmitter.mutateAsync({
        name,
        designation: designation || undefined,
        description: description || undefined,
        function_code_id: functionCodeId,
      });
      setName("");
      setDesignation("");
      setFunctionCodeId("");
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
          <button className="button primary" onClick={() => setShowAddModal(true)}>+ Add Emitter</button>
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
                Function code
                <select value={functionCodeId} onChange={(e) => setFunctionCodeId(e.target.value)} required>
                  <option value="">— what kind of emitter —</option>
                  {(functionCodes ?? []).map((fc) => (
                    <option key={fc.id} value={fc.id} title={fc.description ?? undefined}>
                      {functionCodeLabel(fc)}
                    </option>
                  ))}
                </select>
                {functionCodes && functionCodes.length === 0 && (
                  <span className="error-text">
                    No function codes yet —{" "}
                    {user?.role === "admin" ? <Link to="/admin/function-codes">add them under Admin</Link> : "an Admin adds them under Admin"} first.
                  </span>
                )}
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
        <select aria-label="Function code" value={codeFilter} onChange={(e) => setCodeFilter(e.target.value)}>
          <option value="">Any function code</option>
          {(functionCodes ?? []).map((fc) => (
            <option key={fc.id} value={fc.id}>
              {functionCodeLabel(fc)}
            </option>
          ))}
          <option value="none">No function code</option>
        </select>
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
        {hiddenShown.length > 0 && (
          <button
            type="button"
            className="button secondary small filter-toggle active"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              setStatusMenu({ x: r.left, y: r.bottom + 4 });
            }}
            title={`Not shown: ${hiddenShown.map((k) => statuses.label(k)).join(", ")} — click to change`}
          >
            Statuses: {statusOptions.length - hiddenShown.length} of {statusOptions.length} ▾
          </button>
        )}
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
        <div className="matrix-scroll card table-card">
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
              {show("status") && (
                <SortableColumnHeader
                  label="Status"
                  columnKey="status"
                  activeKey={sortKey}
                  activeDir={sortDir}
                  onSort={onSort}
                  onClear={onClear}
                  rowSpan={2}
                  title="Right-click to choose which statuses to show"
                  sortLabels={{ asc: "Sort first → last status", desc: "Sort last → first status" }}
                  onContextMenu={openStatusMenu}
                  menuExtra={[{ label: "Choose statuses to show…", onSelect: setStatusMenu }]}
                  marked={
                    hiddenShown.length
                      ? { title: `Hiding ${hiddenShown.length} status${hiddenShown.length === 1 ? "" : "es"}` }
                      : undefined
                  }
                />
              )}
              {show("function_code") && header("Function code", "function_code")}
              {show("assignee") && header("Assigned to", "assignee")}
              {show("platforms") && header("Platforms", "platforms")}
              {RANGES.map(([id, label, unit]) => (
                <th key={id} colSpan={2} className="range-group">
                  {label} <span className="range-unit">({unit})</span>
                </th>
              ))}
              {show("sim") && header("SIM correct", "sim_correct", "number")}
              {show("sim_created") &&
                header("SIM created", "sim_created", "date", {
                  rowSpan: 2,
                  title: "When the simulation in its latest simulation run was created",
                })}
              {show("last_tested") &&
                header("Last tested", "last_tested", "date", { rowSpan: 2, title: "Its latest test run, of any kind" })}
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
                {show("function_code") && (
                  <td title={e.function_code_id ? functionCodeLabel(codesById.get(e.function_code_id)) : undefined}>
                    {e.function_code_id && codesById.get(e.function_code_id) ? (
                      <span className="emitters-code">{codesById.get(e.function_code_id)?.code}</span>
                    ) : (
                      <span className="muted">—</span>
                    )}
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
                {show("sim_created") && <td className="nowrap">{formatDate(e.sim_created_date)}</td>}
                {show("last_tested") && (
                  <td className="nowrap">
                    {e.last_tested_at && e.last_tested_test_record_id ? (
                      <Link to={`/emitters/${e.id}/tests/${e.last_tested_test_record_id}`}>{formatDate(e.last_tested_at)}</Link>
                    ) : (
                      "—"
                    )}
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
                      {
                        label: "Export XML",
                        onSelect: () =>
                          void exportEmitterXml(e).catch((err) =>
                            setDeleteError(err instanceof Error ? `Couldn't export ${e.name}: ${err.message}` : `Couldn't export ${e.name}`),
                          ),
                      },
                      { label: "Compare with another Emitter", to: `/emitters/compare?a=${e.id}` },
                      ...(canWrite ? [{ label: "Duplicate…", onSelect: () => setDuplicating(e) }] : []),
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
      {statusMenu && (
        <CheckMenu
          title="Statuses to show"
          ariaLabel="Choose statuses to show"
          anchor={statusMenu}
          onClose={closeStatusMenu}
          items={statusOptions.map((o) => ({
            id: o.key,
            label: <StatusBadge type="emitter" status={o.key} />,
            checked: !hiddenStatuses.includes(o.key),
            hint: o.count,
          }))}
          onToggle={toggleStatus}
          footer={
            <div className="column-menu-actions">
              <button type="button" className="link-button" disabled={hiddenShown.length === 0} onClick={() => setHiddenStatuses([])}>
                Show all
              </button>
              <button
                type="button"
                className="link-button"
                disabled={hiddenShown.length === statusOptions.length}
                onClick={() => setHiddenStatuses(statusOptions.map((o) => o.key))}
              >
                Show none
              </button>
            </div>
          }
        />
      )}
      {dialog}
      {duplicating && (
        <DuplicateEmitterModal emitterId={duplicating.id} emitterName={duplicating.name} onClose={() => setDuplicating(null)} />
      )}
    </div>
  );
}
