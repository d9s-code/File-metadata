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

  function handleSort(key: ModeSortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
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

  const canAddMode = ewGroups.length > 0 && sources.length > 0;

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
      </div>

      {isLoading ? (
        <p className="page-loading">Loading…</p>
      ) : sorted.length === 0 ? (
        <p className="hint-text">
          {modes && modes.length > 0
            ? "No Modes match the current search/filters."
            : "No Modes yet — add a Source, then either type a DSL line or add Elements and run Cartesian Product."}
        </p>
      ) : view === "table" ? (
        <ModesTable
          emitterId={emitterId}
          modes={sorted}
          ewGroupsById={ewGroupsById}
          sourcesById={sourcesById}
          sortKey={sortKey}
          sortDir={sortDir}
          onSort={handleSort}
          onDelete={handleDelete}
        />
      ) : (
        <ModesCardGrid
          emitterId={emitterId}
          modes={sorted}
          ewGroupsById={ewGroupsById}
          sourcesById={sourcesById}
          onDelete={handleDelete}
        />
      )}

      <RequireRole minimum="editor">
        {!canAddMode ? (
          <p className="hint-text">Add a Source and an EW Group first.</p>
        ) : showForm ? (
          <ModeForm emitterId={emitterId} ewGroups={ewGroups} sources={sources} defaultEwGroupId={ewGroupFilter} />
        ) : (
          <button className="icon-button" onClick={() => setShowForm(true)}>
            + Add Mode
          </button>
        )}
      </RequireRole>
      {dialog}
    </section>
  );
}
