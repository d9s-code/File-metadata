import { useState, type FormEvent } from "react";
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
import { EMITTER_STATUS_LABEL } from "../components/common/emitterStatusLabel";
import { TasksButton } from "../components/tasks/TasksButton";
import { useTasks } from "../state/hooks/useTasks";
import type { Platform } from "../api/platforms";
import type { EmitterStatus } from "../types/domain";

type PlatformSortKey = "name" | "description" | "emitters" | "status" | "outdated" | "modes" | "mdfs" | "ambiguity" | "saved";

// Worst first, as the backend picks the worst status.
const STATUS_RANK: Record<EmitterStatus, number> = { deprecated: 0, draft: 1, in_review: 2, validated: 3 };
const STATUS_ORDER: EmitterStatus[] = ["deprecated", "draft", "in_review", "validated"];

function comparePlatforms(a: Platform, b: Platform, key: PlatformSortKey, dir: "asc" | "desc"): number {
  const sa = a.summary;
  const sb = b.summary;
  switch (key) {
    case "name":
      return compareStrings(a.name, b.name, dir);
    case "description":
      return compareStrings(a.description, b.description, dir);
    case "emitters":
      return compareNullable(sa?.emitter_count, sb?.emitter_count, dir);
    case "status":
      return compareNullable(
        sa?.worst_status ? STATUS_RANK[sa.worst_status] : null,
        sb?.worst_status ? STATUS_RANK[sb.worst_status] : null,
        dir,
      );
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

function statusTitle(counts: Record<EmitterStatus, number>): string {
  return STATUS_ORDER.filter((s) => counts[s])
    .map((s) => `${counts[s]} ${EMITTER_STATUS_LABEL[s]}`)
    .join(" · ");
}

export function PlatformsListPage() {
  const { data: platforms, isLoading } = usePlatforms();
  const { sorted, sortKey, sortDir, onSort, onClear } = useSortableTable(platforms ?? [], comparePlatforms);
  const createPlatform = useCreatePlatform();
  const deletePlatform = useDeletePlatform();
  const { confirmDelete, dialog } = useConfirmDialog();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [filter, setFilter] = useState("");
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
      <div className="page-header-row">
        <h1>Platforms</h1>
        <RequireRole minimum="editor">
          <button onClick={() => setShowAdd(true)}>+ Add Platform</button>
        </RequireRole>
      </div>
      <p className="hint-text">Platforms group Emitters — this is what gets pinned into an MDF.</p>

      {showAdd && (
        <Modal title="Add Platform" onClose={() => setShowAdd(false)}>
          <form onSubmit={handleCreate}>
            <div className="form-row">
              <input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
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
        <div className="card">
          <div className="modes-toolbar-row">
            <input placeholder="Filter by name or description…" value={filter} onChange={(e) => setFilter(e.target.value)} />
            <button type="button" className="link-button" onClick={() => setFilter("")}>
              Reset filters
            </button>
          </div>
        </div>
      )}

      {isLoading ? (
        <LoadingState label="Loading platforms…" />
      ) : platforms && platforms.length === 0 ? (
        <EmptyState icon="◇" title="No Platforms yet" message="Add one with + Add Platform, then pin saved Emitter versions to it." />
      ) : (
        <table className="data-table platforms-table">
          <thead>
            <tr>
              {header("Name", "name")}
              {header("Description", "description")}
              {header("Emitters", "emitters", "Emitters pinned on the Platform", "number")}
              {header("Emitter status", "status", "The worst status among the pinned Emitters")}
              {header("Outdated pins", "outdated", "Pinned Emitters with a newer saved version", "number")}
              {header("Modes", "modes", "Modes in the pinned Emitter versions", "number")}
              {header("In MDFs", "mdfs", "MDFs this Platform is pinned in", "number")}
              {header("Ambiguity", "ambiguity", "From the latest ambiguity check: Emitters that could be taken for another", "number")}
              {header("Last saved", "saved", undefined, "date")}
              <th>Tasks</th>
              <th></th>
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
                  <td className="platforms-description" title={p.description ?? undefined}>
                    {p.description ?? "—"}
                  </td>
                  <td className="num">{s?.emitter_count ?? "—"}</td>
                  <td>
                    {s?.worst_status ? (
                      <span title={statusTitle(s.status_counts)}>
                        <span className={`status-badge status-${s.worst_status}`}>{EMITTER_STATUS_LABEL[s.worst_status]}</span>
                        {s.emitter_count > 1 && (
                          <span className="hint-text">
                            {" "}
                            {s.status_counts[s.worst_status]} of {s.emitter_count}
                          </span>
                        )}
                      </span>
                    ) : (
                      <span className="hint-text">—</span>
                    )}
                  </td>
                  <td className="num">
                    {s?.outdated_pins ? (
                      <span className="status-badge status-pending_review" title="Pinned Emitters with a newer saved version">
                        {s.outdated_pins}
                      </span>
                    ) : (
                      <span className="hint-text">0</span>
                    )}
                  </td>
                  <td className="num">{s?.mode_count ?? "—"}</td>
                  <td className="num">{s?.mdf_count ?? "—"}</td>
                  <td>
                    {s?.ambiguity_checked_at == null ? (
                      <span className="hint-text">Not checked</span>
                    ) : (
                      <Link
                        to={`/ambiguity/platform/${p.id}`}
                        title={`Checked ${new Date(s.ambiguity_checked_at).toLocaleString()}`}
                        className={s.ambiguous_emitters ? "platforms-ambiguous" : undefined}
                      >
                        {s.ambiguous_emitters
                          ? `${s.ambiguous_emitters} Emitters · ${s.open_ambiguities} open`
                          : "None found"}
                      </Link>
                    )}
                  </td>
                  <td>
                    {s?.latest_version_number != null && s.latest_version_at ? (
                      <span title={new Date(s.latest_version_at).toLocaleString()}>
                        v{s.latest_version_number} · {new Date(s.latest_version_at).toLocaleDateString()}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>
                    <TasksButton type="platform" id={p.id} name={p.name} openCount={openTasks.get(p.id) ?? 0} compact />
                  </td>
                  <td>
                    <RequireRole minimum="editor">
                      <button className="link-button link-button-danger" onClick={() => void handleDelete(p)}>
                        Delete
                      </button>
                    </RequireRole>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {dialog}
    </div>
  );
}
