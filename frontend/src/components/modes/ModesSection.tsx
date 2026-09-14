import { useEffect, useMemo, useState } from "react";
import type { EwGroup, Source } from "../../types/domain";
import { useDeleteMode, useEmitterModes } from "../../state/hooks/useModes";
import { useDeleteBatch, useEmitterBatches } from "../../state/hooks/useModeBatches";
import { useConfirmDialog } from "../common/ConfirmDialog";
import { ModesTable } from "./ModesTable";
import { ModesCardGrid } from "./ModesCardGrid";
import { ModesViewToggle, type ModesView } from "./ModesViewToggle";
import { ModeForm } from "./ModeForm";
import { compareModes, searchableText, type ModeSortKey, type SortDir } from "./modeFormat";
import { RequireRole } from "../../auth/RequireAuth";
import { EmptyState } from "../common/EmptyState";
import { LoadingState } from "../common/LoadingState";
import { useEmitter } from "../../state/hooks/useEmitters";
import { useEmitterCheckoutState } from "../../state/hooks/useEmitterCheckout";
import { BatchEditModal } from "./BatchEditModal";

const VIEW_STORAGE_KEY = "modesView";

function readStoredView(): ModesView {
  try {
    return localStorage.getItem(VIEW_STORAGE_KEY) === "cards" ? "cards" : "table";
  } catch {
    return "table";
  }
}

export function ModesSection({
  emitterId,
  ewGroups,
  sources,
}: {
  emitterId: string;
  ewGroups: EwGroup[];
  sources: Source[];
}) {
  const { data: modes, isLoading } = useEmitterModes(emitterId);
  const { data: batches } = useEmitterBatches(emitterId);
  const deleteMode = useDeleteMode(emitterId);
  const deleteBatch = useDeleteBatch(emitterId);
  const { confirmDelete, dialog } = useConfirmDialog();
  const [view, setView] = useState<ModesView>(readStoredView);
  const [ewGroupFilter, setEwGroupFilter] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");
  const [batchFilter, setBatchFilter] = useState("");
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<ModeSortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [showForm, setShowForm] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showBatchEdit, setShowBatchEdit] = useState(false);
  const { data: emitter } = useEmitter(emitterId);
  const { canEdit } = useEmitterCheckoutState(emitter);

  useEffect(() => {
    try {
      localStorage.setItem(VIEW_STORAGE_KEY, view);
    } catch {
      // localStorage unavailable — the view choice just won't persist.
    }
  }, [view]);

  const ewGroupsById = useMemo(() => Object.fromEntries(ewGroups.map((g) => [g.id, g])), [ewGroups]);
  const sourcesById = useMemo(() => Object.fromEntries(sources.map((s) => [s.id, s])), [sources]);

  const filtered = (modes ?? []).filter(
    (m) =>
      (!ewGroupFilter || m.ew_group_id === ewGroupFilter) &&
      (!sourceFilter || m.source_id === sourceFilter) &&
      (!batchFilter || m.generation_batch_id === batchFilter),
  );

  const searched = search.trim()
    ? filtered.filter((m) => searchableText(m, ewGroupsById[m.ew_group_id], sourcesById[m.source_id]).includes(search.trim().toLowerCase()))
    : filtered;

  const sorted = [...searched].sort((a, b) => compareModes(a, b, sortKey, sortDir, ewGroupsById, sourcesById));

  // Selection survives filter/sort changes (so you can select across
  // several filters), but not a Mode actually disappearing (deleted, or a
  // batch-edit just applied and the list refetched).
  useEffect(() => {
    if (!modes) return;
    const liveIds = new Set(modes.map((m) => m.id));
    setSelected((prev) => {
      const next = new Set([...prev].filter((id) => liveIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [modes]);

  function toggleSelect(modeId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(modeId)) next.delete(modeId);
      else next.add(modeId);
      return next;
    });
  }

  function toggleSelectAll() {
    const visibleIds = sorted.map((m) => m.id);
    const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelected) visibleIds.forEach((id) => next.delete(id));
      else visibleIds.forEach((id) => next.add(id));
      return next;
    });
  }

  function handleSort(key: ModeSortKey, dir: SortDir) {
    setSortKey(key);
    setSortDir(dir);
  }

  function handleClearSort() {
    setSortKey("name");
    setSortDir("asc");
  }

  async function handleDelete(modeId: string, ewGroupId: string, name: string) {
    if (await confirmDelete(`Delete Mode "${name}"?`)) {
      await deleteMode.mutateAsync({ ewGroupId, modeId });
    }
  }

  const selectedBatch = (batches ?? []).find((b) => b.id === batchFilter);

  async function handleDeleteBatch() {
    if (!selectedBatch) return;
    if (
      await confirmDelete(
        `Delete this generation batch ("${selectedBatch.name_prefix}") and all ${selectedBatch.mode_count} Mode(s) it created?`,
      )
    ) {
      await deleteBatch.mutateAsync(selectedBatch.id);
      setBatchFilter("");
    }
  }

  const hasSetup = ewGroups.length > 0 && sources.length > 0;
  const canAddMode = hasSetup && canEdit;

  return (
    <section className="card">
      <div className="modes-section-header">
        <h4>Modes</h4>
        <ModesViewToggle view={view} onChange={setView} />
      </div>

      <div className="modes-toolbar-row">
        <input
          type="text"
          placeholder="Search modes…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select value={ewGroupFilter} onChange={(e) => setEwGroupFilter(e.target.value)}>
          <option value="">All EW Groups</option>
          {ewGroups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
        <select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)}>
          <option value="">All Sources</option>
          {sources.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <select value={batchFilter} onChange={(e) => setBatchFilter(e.target.value)}>
          <option value="">All Batches</option>
          {(batches ?? []).map((b) => (
            <option key={b.id} value={b.id}>
              {b.name_prefix} — {b.mode_count} modes — {new Date(b.created_at).toLocaleDateString()}
            </option>
          ))}
        </select>
        {selectedBatch && (
          <RequireRole minimum="editor">
            <button className="icon-button" onClick={() => void handleDeleteBatch()}>
              Delete this batch ({selectedBatch.mode_count})
            </button>
          </RequireRole>
        )}
        {selected.size > 0 && (
          <RequireRole minimum="editor">
            <button
              className="accent-button"
              disabled={!canEdit}
              title={canEdit ? undefined : "Start editing this Emitter first"}
              onClick={() => setShowBatchEdit(true)}
            >
              Batch Edit ({selected.size})
            </button>
            <button className="link-button" onClick={() => setSelected(new Set())}>
              Clear selection
            </button>
          </RequireRole>
        )}
      </div>

      {isLoading ? (
        <LoadingState label="Loading modes…" />
      ) : sorted.length === 0 ? (
        <EmptyState
          icon="◇"
          title={modes && modes.length > 0 ? "No matches" : "No Modes yet"}
          message={
            modes && modes.length > 0
              ? "No Modes match the current search/filters."
              : "Add a Source, then either type a DSL line or add Elements and run Cartesian Product."
          }
        />
      ) : view === "table" ? (
        <ModesTable
          emitterId={emitterId}
          modes={sorted}
          ewGroupsById={ewGroupsById}
          sourcesById={sourcesById}
          sortKey={sortKey}
          sortDir={sortDir}
          onSort={handleSort}
          onClear={handleClearSort}
          onDelete={handleDelete}
          selected={selected}
          onToggleSelect={toggleSelect}
          onToggleSelectAll={toggleSelectAll}
        />
      ) : (
        <ModesCardGrid
          emitterId={emitterId}
          modes={sorted}
          ewGroupsById={ewGroupsById}
          sourcesById={sourcesById}
          onDelete={handleDelete}
          selected={selected}
          onToggleSelect={toggleSelect}
        />
      )}

      <RequireRole minimum="editor">
        {!hasSetup ? (
          <p className="hint-text">Add a Source and an EW Group first.</p>
        ) : showForm && canAddMode ? (
          <ModeForm emitterId={emitterId} ewGroups={ewGroups} sources={sources} defaultEwGroupId={ewGroupFilter} />
        ) : (
          <button
            className="icon-button"
            disabled={!canEdit}
            title={canEdit ? undefined : "Start editing this Emitter first"}
            onClick={() => setShowForm(true)}
          >
            + Add Mode
          </button>
        )}
      </RequireRole>
      {showBatchEdit && (
        <BatchEditModal
          emitterId={emitterId}
          modeIds={[...selected]}
          ewGroups={ewGroups}
          onClose={() => setShowBatchEdit(false)}
          onDone={() => {
            setShowBatchEdit(false);
            setSelected(new Set());
          }}
        />
      )}
      {dialog}
    </section>
  );
}
