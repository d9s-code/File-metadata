import { useCallback, useState, type FormEvent } from "react";
import { formatDate, formatDateTime } from "../components/common/dates";
import { MenuButton } from "../components/common/MenuButton";
import { FilterBar, shownCount } from "../components/common/FilterBar";
import { PageHeader } from "../components/common/PageHeader";
import { AllegianceChip, allegianceLabel, convertSpeed, speedText } from "../components/platform/platformTraits";
import { Link, useNavigate } from "react-router-dom";
import { useCreatePlatform, useDeletePlatform, usePlatforms } from "../state/hooks/usePlatforms";
import { RequireRole } from "../auth/RequireAuth";
import { ApiRequestError } from "../api/client";
import { LoadingState } from "../components/common/LoadingState";
import { EmptyState } from "../components/common/EmptyState";
import { Modal } from "../components/common/Modal";
import { SortableColumnHeader, type ColumnType } from "../components/common/SortableColumnHeader";
import { useSortableTable } from "../components/common/useSortableTable";
import { compareNullable, compareStrings } from "../components/common/sortUtils";
import { useConfirmDialog } from "../components/common/ConfirmDialog";
import { StatusBadge } from "../components/status/StatusBadge";
import { useStatuses } from "../state/hooks/useStatuses";
import { TasksButton } from "../components/tasks/TasksButton";
import { useTasks } from "../state/hooks/useTasks";
import { useColumnVisibility, useColumnVisibilityMenu, type ToggleableColumn } from "../components/common/ColumnVisibilityMenu";
import type { Platform } from "../api/platforms";
import { useSessionState } from "../components/common/useSessionState";

type PlatformSortKey =
  | "name"
  | "description"
  | "own_status"
  | "allegiance"
  | "speed"
  | "emitters"
  | "progress"
  | "outdated"
  | "modes"
  | "mdfs"
  | "ambiguity"
  | "saved";

type ColumnId =
  | "description"
  | "status"
  | "allegiance"
  | "speed"
  | "emitters"
  | "progress"
  | "outdated"
  | "modes"
  | "mdfs"
  | "ambiguity"
  | "saved"
  | "tasks";

/** The columns that can be hidden (Columns ▾); Name always shows. */
const COLUMNS: ToggleableColumn<ColumnId>[] = [
  { id: "description", label: "Description" },
  { id: "status", label: "Platform status" },
  { id: "allegiance", label: "Allegiance" },
  { id: "speed", label: "Speed" },
  { id: "emitters", label: "Emitters" },
  { id: "progress", label: "Emitter progress" },
  { id: "outdated", label: "Outdated pins" },
  { id: "modes", label: "Modes" },
  { id: "mdfs", label: "In MDFs" },
  { id: "ambiguity", label: "Ambiguity" },
  { id: "saved", label: "Last saved" },
  { id: "tasks", label: "Tasks" },
];

function topSpeedKmh(p: Platform): number | null {
  const v = p.speed_max ?? p.speed_min;
  return v == null ? null : convertSpeed(v, p.speed_unit ?? "kmh", "kmh");
}

/** The Platform status column sorts A–Z by the name shown: `platformStatus`
 * gives it for a status key. */
function comparePlatforms(
  a: Platform,
  b: Platform,
  key: PlatformSortKey,
  dir: "asc" | "desc",
  platformStatus: (key: string) => string,
): number {
  const sa = a.summary;
  const sb = b.summary;
  switch (key) {
    case "name":
      return compareStrings(a.name, b.name, dir);
    case "description":
      return compareStrings(a.description, b.description, dir);
    case "emitters":
      return compareNullable(sa?.emitter_count, sb?.emitter_count, dir);
    case "progress":
      return compareNullable(sa?.emitter_progress, sb?.emitter_progress, dir);
    case "own_status":
      return compareStrings(a.status ? platformStatus(a.status) : null, b.status ? platformStatus(b.status) : null, dir);
    case "allegiance":
      return compareStrings(a.allegiance ? allegianceLabel(a.allegiance) : null, b.allegiance ? allegianceLabel(b.allegiance) : null, dir);
    case "speed":
      // By the highest speed, in km/h whatever the unit.
      return compareNullable(topSpeedKmh(a), topSpeedKmh(b), dir);
    case "outdated":
      return compareNullable(sa?.outdated_pins, sb?.outdated_pins, dir);
    case "modes":
      return compareNullable(sa?.mode_count, sb?.mode_count, dir);
    case "mdfs":
      return compareNullable(sa?.mdf_count, sb?.mdf_count, dir);
    case "ambiguity":
      return compareNullable(sa?.ambiguous_emitters, sb?.ambiguous_emitters, dir);
    case "saved":
      return compareStrings(sa?.latest_version_at, sb?.latest_version_at, dir);
  }
}

export function PlatformsListPage() {
  const { data: platforms, isLoading } = usePlatforms();
  const emitterStatuses = useStatuses("emitter");
  const statusTitle = (counts: Record<string, number>) =>
    Object.entries(counts)
      .filter(([, n]) => n)
      .map(([k, n]) => `${n} ${emitterStatuses.label(k)}`)
      .join(" · ");
  const platformStatuses = useStatuses("platform");
  const columns = useColumnVisibility("platforms-list-columns", COLUMNS);
  const columnMenu = useColumnVisibilityMenu(columns);
  const show = columns.isVisible;
  const comparator = useCallback(
    (a: Platform, b: Platform, key: PlatformSortKey, dir: "asc" | "desc") =>
      comparePlatforms(a, b, key, dir, platformStatuses.label),
    [platformStatuses],
  );
  const { sorted, sortKey, sortDir, onSort, onClear } = useSortableTable(platforms ?? [], comparator, "platforms");
  const createPlatform = useCreatePlatform();
  const deletePlatform = useDeletePlatform();
  const { confirmDelete, dialog } = useConfirmDialog();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [filter, setFilter] = useSessionState("platforms.filter", "");
  const navigate = useNavigate();
  // Open tasks about each Platform, counted once for the whole list.
  const { data: platformTasks } = useTasks({ entity_type: "platform", state: "open" });
  const openTasks = new Map<string, number>();
  for (const t of platformTasks ?? []) if (t.entity_id) openTasks.set(t.entity_id, (openTasks.get(t.entity_id) ?? 0) + 1);
  const header = (label: string, columnKey: PlatformSortKey, title?: string, columnType?: ColumnType) => (
    <SortableColumnHeader
      label={title ? <span title={title}>{label}</span> : label}
      columnKey={columnKey}
      columnType={columnType}
      activeKey={sortKey}
      activeDir={sortDir}
      onSort={onSort}
      onClear={onClear}
    />
  );

  async function handleDelete(platform: Platform) {
    if (await confirmDelete(`Delete Platform "${platform.name}"? It can be restored from Recently Deleted for 30 days.`)) {
      await deletePlatform.mutateAsync({ id: platform.id });
    }
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const platform = await createPlatform.mutateAsync({ name, description: description || undefined });
      setName("");
      setDescription("");
      setShowAdd(false);
      navigate(`/platforms/${platform.id}`);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Failed to create platform");
    }
  }

  const query = filter.trim().toLowerCase();
  const visible = query
    ? sorted.filter((p) => `${p.name} ${p.description ?? ""}`.toLowerCase().includes(query))
    : sorted;

  return (
    <div className="page">
      <PageHeader title="Platforms" info="Platforms group Emitters — this is what gets pinned into an MDF.">
        <RequireRole minimum="editor">
          <button className="button primary" onClick={() => setShowAdd(true)}>+ Add Platform</button>
        </RequireRole>
      </PageHeader>

      {showAdd && (
        <Modal title="Add Platform" onClose={() => setShowAdd(false)}>
          <form onSubmit={handleCreate}>
            <div className="form-row">
              <label className="wide-label">
                Name
                <input value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
              </label>
            </div>
            <div className="form-row">
              <label className="wide-label">
                Description (optional)
                <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
              </label>
            </div>
            {error && <div className="error-text">{error}</div>}
            <div className="modal-actions">
              <button type="button" className="button secondary" onClick={() => setShowAdd(false)}>
                Cancel
              </button>
              <button type="submit" className="button primary" disabled={createPlatform.isPending}>
                Add Platform
              </button>
            </div>
          </form>
        </Modal>
      )}

      {platforms && platforms.length > 0 && (
        <FilterBar
          active={!!filter}
          onReset={() => setFilter("")}
          count={shownCount(visible.length, platforms.length, "Platform")}
          end={
            <button type="button" className="button secondary small" onClick={columnMenu.openFrom}>
              Columns ▾
            </button>
          }
        >
          <input
            type="search"
            placeholder="Name or description…"
            aria-label="Filter by name or description"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </FilterBar>
      )}

      {isLoading ? (
        <LoadingState label="Loading platforms…" />
      ) : platforms && platforms.length === 0 ? (
        <EmptyState icon="◇" title="No Platforms yet" message="Add one with + Add Platform, then pin saved Emitter versions to it." />
      ) : (
        <div className="card table-card">
          <table className="data-table platforms-table">
            <thead>
              <tr {...columnMenu.openProps}>
                {header("Name", "name")}
                {show("description") && header("Description", "description")}
                {show("status") && header("Platform status", "own_status", "The Platform's own status")}
                {show("allegiance") && header("Allegiance", "allegiance", "Hostile, neutral or friendly — the PRS XML's Hostility")}
                {show("speed") && header("Speed", "speed", "Its speed range, in km/h or knots (sorted by the highest, in km/h)", "number")}
                {show("emitters") && header("Emitters", "emitters", "Emitters pinned on the Platform", "number")}
                {show("progress") &&
                  header(
                  "Emitter progress",
                  "progress",
                  "How far the pinned Emitters are towards Operational, on average: In progress 0%, Testing 33%, Partially operational 67%, Operational 100%, Needs rework 0%. Hover a row for how many are in each status.",
                  "number",
                )}
                {show("outdated") && header("Outdated pins", "outdated", "Pinned Emitters with a newer saved version", "number")}
                {show("modes") && header("Modes", "modes", "Modes in the pinned Emitter versions", "number")}
                {show("mdfs") && header("In MDFs", "mdfs", "MDFs this Platform is pinned in", "number")}
                {show("ambiguity") && header("Ambiguity", "ambiguity", "From the latest ambiguity check: Emitters that could be taken for another", "number")}
                {show("saved") && header("Last saved", "saved", undefined, "date")}
                {show("tasks") && <th>Tasks</th>}
                <th className="row-actions" aria-label="Actions"></th>
              </tr>
            </thead>
            <tbody>
              {visible.map((p) => {
                const s = p.summary;
                return (
                  <tr key={p.id}>
                    <td>
                      <Link to={`/platforms/${p.id}`}>{p.name}</Link>
                    </td>
                    {show("description") && (
                      <td className="platforms-description" title={p.description ?? undefined}>
                        {p.description ?? "—"}
                      </td>
                    )}
                    {show("status") && (
                      <td>
                        <StatusBadge type="platform" status={p.status} />
                      </td>
                    )}
                    {show("allegiance") && (
                      <td>
                        <AllegianceChip allegiance={p.allegiance} />
                      </td>
                    )}
                    {show("speed") && <td className="num">{speedText(p) ?? <span className="hint-text">—</span>}</td>}
                    {show("emitters") && (
                      <td className="num">{s?.emitter_count ?? "—"}</td>
                    )}
                    {show("progress") && (
                      <td className="platforms-progress">
                        {s?.emitter_progress != null ? (
                          <span className="platforms-progress-cell" title={statusTitle(s.status_counts)}>
                            <span
                              className="progress-bar-track"
                              role="progressbar"
                              aria-valuenow={s.emitter_progress}
                              aria-valuemin={0}
                              aria-valuemax={100}
                              aria-label="Emitter progress"
                            >
                              <span className="progress-bar-fill" style={{ width: `${s.emitter_progress}%` }} />
                            </span>
                            <span className="platforms-progress-value">{s.emitter_progress}%</span>
                            <span className="hint-text platforms-progress-detail">{statusTitle(s.status_counts)}</span>
                          </span>
                        ) : (
                          <span className="hint-text">—</span>
                        )}
                      </td>
                    )}
                    {show("outdated") && (
                      <td className="num">
                        {s?.outdated_pins ? (
                          <span className="status-badge status-pending_review" title="Pinned Emitters with a newer saved version">
                            {s.outdated_pins}
                          </span>
                        ) : (
                          <span className="hint-text">0</span>
                        )}
                      </td>
                    )}
                    {show("modes") && (
                      <td className="num">{s?.mode_count ?? "—"}</td>
                    )}
                    {show("mdfs") && (
                      <td className="num">{s?.mdf_count ?? "—"}</td>
                    )}
                    {show("ambiguity") && (
                      <td>
                        {s?.ambiguity_checked_at == null ? (
                          <span className="hint-text">Not checked</span>
                        ) : (
                          <Link
                            to={`/ambiguity/platform/${p.id}`}
                            title={`Checked ${formatDateTime(s.ambiguity_checked_at)}`}
                            className={s.ambiguous_emitters ? "platforms-ambiguous" : undefined}
                          >
                            {s.ambiguous_emitters
                              ? `${s.ambiguous_emitters} Emitters · ${s.open_ambiguities} open`
                              : "None found"}
                          </Link>
                        )}
                      </td>
                    )}
                    {show("saved") && (
                      <td>
                        {s?.latest_version_number != null && s.latest_version_at ? (
                          <span title={formatDateTime(s.latest_version_at)}>
                            v{s.latest_version_label ?? s.latest_version_number} · {formatDate(s.latest_version_at)}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                    )}
                    {show("tasks") && (
                      <td>
                        <TasksButton type="platform" id={p.id} name={p.name} openCount={openTasks.get(p.id) ?? 0} compact />
                      </td>
                    )}
                    <td className="row-actions">
                      <RequireRole minimum="editor">
                        <MenuButton
                          label="⋯"
                          className="row-menu-button"
                          ariaLabel={`Actions for ${p.name}`}
                          items={[{ label: "Delete…", danger: true, onSelect: () => void handleDelete(p) }]}
                        />
                      </RequireRole>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {dialog}
      {columnMenu.menu}
    </div>
  );
}
