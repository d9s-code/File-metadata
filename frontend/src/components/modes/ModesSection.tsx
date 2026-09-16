import { useEffect, useMemo, useState } from "react";
import type { EwGroup, Source } from "../../types/domain";
import { useDeleteMode, useEmitterModes } from "../../state/hooks/useModes";
import { useDeleteBatch, useEmitterBatches } from "../../state/hooks/useModeBatches";
import { useConfirmDialog } from "../common/ConfirmDialog";
import { ModesTable } from "./ModesTable";
import { ModesCardGrid } from "./ModesCardGrid";
import { ModesViewToggle, type ModesView } from "./ModesViewToggle";
import { ModeForm } from "./ModeForm";
import { BatchEditModal } from "./BatchEditModal";
import { compareModes, rangeOverlaps, searchableText, type ModeSortKey, type SortDir } from "./modeFormat";
import type { PriType } from "../../types/domain";
import { RequireRole } from "../../auth/RequireAuth";
import { EmptyState } from "../common/EmptyState";
import { LoadingState } from "../common/LoadingState";
import { useEmitter } from "../../state/hooks/useEmitters";
import { useEmitterCheckoutState } from "../../state/hooks/useEmitterCheckout";

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
  const [showMoreFilters, setShowMoreFilters] = useState(false);
  const [rfMin, setRfMin] = useState("");
  const [rfMax, setRfMax] = useState("");
  const [pwMin, setPwMin] = useState("");
  const [pwMax, setPwMax] = useState("");
  const [priMin, setPriMin] = useState("");
  const [priMax, setPriMax] = useState("");
  const [priTypeFilter, setPriTypeFilter] = useState<PriType | "">("");
  const [rfRangeMatchingOnly, setRfRangeMatchingOnly] = useState(false);
  const [pwRangeMatchingOnly, setPwRangeMatchingOnly] = useState(false);
  const [priRangeMatchingOnly, setPriRangeMatchingOnly] = useState(false);
  const [lastTestedFrom, setLastTestedFrom] = useState("");
  const [lastTestedTo, setLastTestedTo] = useState("");
  const [showEngineered, setShowEngineered] = useState(false);
  const { data: emitter } = useEmitter(emitterId);
  const { canEdit } = useEmitterCheckoutState(emitter);

  useEffect(() => {
    try {
      localStorage.setItem(VIEW_STORAGE_KEY, view);
    } catch {
      // localStorage unavailable — the view choice just won't persist.
    }
  }, [view]);

  useEffect(() => {
    setSelected((prev) => {
      const validIds = new Set((modes ?? []).map((m) => m.id));
      const next = new Set([...prev].filter((id) => validIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [modes]);

  const ewGroupsById = useMemo(() => Object.fromEntries(ewGroups.map((g) => [g.id, g])), [ewGroups]);
  const sourcesById = useMemo(() => Object.fromEntries(sources.map((s) => [s.id, s])), [sources]);

  const filtered = (modes ?? []).filter((m) => {
    if (ewGroupFilter && m.ew_group_id !== ewGroupFilter) return false;
    if (sourceFilter && m.source_id !== sourceFilter) return false;
    if (batchFilter && m.generation_batch_id !== batchFilter) return false;
    if (priTypeFilter && m.pri_type !== priTypeFilter) return false;
    if (rfRangeMatchingOnly && !m.line?.rf_range_matching) return false;
    if (pwRangeMatchingOnly && !m.line?.pw_range_matching) return false;
    if (priRangeMatchingOnly && !m.line?.pri_range_matching) return false;
    if (!rangeOverlaps(rfMin, rfMax, m.line?.rf_min_mhz, m.line?.rf_max_mhz)) return false;
    if (!rangeOverlaps(pwMin, pwMax, m.line?.pw_min_us, m.line?.pw_max_us)) return false;
    if (!rangeOverlaps(priMin, priMax, m.line?.pri_min_us, m.line?.pri_max_us)) return false;
    if (lastTestedFrom || lastTestedTo) {
      if (!m.last_tested_at) return false;
      const testedDate = m.last_tested_at.slice(0, 10);
      if (lastTestedFrom && testedDate < lastTestedFrom) return false;
      if (lastTestedTo && testedDate > lastTestedTo) return false;
    }
    return true;
  });

  const searched = search.trim()
    ? filtered.filter((m) => searchableText(m, ewGroupsById[m.ew_group_id], sourcesById[m.source_id]).includes(search.trim().toLowerCase()))
    : filtered;

  const sorted = [...searched].sort((a, b) => compareModes(a, b, sortKey, sortDir, ewGroupsById, sourcesById));

  function handleSort(key: ModeSortKey, dir: SortDir) {
    setSortKey(key);
    setSortDir(dir);
  }

  function handleClearSort() {
    setSortKey("name");
    setSortDir("asc");
  }

  function resetMoreFilters() {
    setRfMin("");
    setRfMax("");
    setPwMin("");
    setPwMax("");
    setPriMin("");
    setPriMax("");
    setPriTypeFilter("");
    setRfRangeMatchingOnly(false);
    setPwRangeMatchingOnly(false);
    setPriRangeMatchingOnly(false);
    setLastTestedFrom("");
    setLastTestedTo("");
  }

  const activeMoreFiltersCount = [
    rfMin || rfMax,
    pwMin || pwMax,
    priMin || priMax,
    priTypeFilter,
    rfRangeMatchingOnly,
    pwRangeMatchingOnly,
    priRangeMatchingOnly,
    lastTestedFrom || lastTestedTo,
  ].filter(Boolean).length;

  async function handleDelete(modeId: string, ewGroupId: string, name: string) {
    if (await confirmDelete(`Delete Mode "${name}"?`)) {
      await deleteMode.mutateAsync({ ewGroupId, modeId });
    }
  }

  function toggleSelect(modeId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(modeId)) next.delete(modeId);
      else next.add(modeId);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelected((prev) => {
      const allSelected = sorted.length > 0 && sorted.every((m) => prev.has(m.id));
      if (allSelected) return new Set();
      return new Set(sorted.map((m) => m.id));
    });
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
        <label className="inline-field-label" title="Show each parameter's engineered (raw ± delta) value directly, instead of the raw value with its delta shown separately">
          <input
            type="checkbox"
            checked={showEngineered}
            onChange={(e) => setShowEngineered(e.target.checked)}
          />
          Show engineered values
        </label>
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
        <button type="button" className="link-button" onClick={() => setShowMoreFilters((v) => !v)}>
          {showMoreFilters ? "Hide filters" : "More filters"}
          {activeMoreFiltersCount > 0 ? ` (${activeMoreFiltersCount})` : ""}
        </button>
        {selectedBatch && (
          <RequireRole minimum="editor">
            <button className="icon-button" onClick={() => void handleDeleteBatch()}>
              Delete this batch ({selectedBatch.mode_count})
            </button>
          </RequireRole>
        )}
        {selected.size > 0 && (
          <RequireRole minimum="editor">
            <button className="accent-button" disabled={!canEdit} onClick={() => setShowBatchEdit(true)}>
              Batch Edit ({selected.size})
            </button>
            <button className="link-button" onClick={() => setSelected(new Set())}>
              Clear selection
            </button>
          </RequireRole>
        )}
      </div>

      {showMoreFilters && (
        <div className="modes-toolbar-row">
          <label>
            RF (MHz)
            <input type="number" step="any" placeholder="min" value={rfMin} onChange={(e) => setRfMin(e.target.value)} />
            <input type="number" step="any" placeholder="max" value={rfMax} onChange={(e) => setRfMax(e.target.value)} />
          </label>
          <label>
            PW (µs)
            <input type="number" step="any" placeholder="min" value={pwMin} onChange={(e) => setPwMin(e.target.value)} />
            <input type="number" step="any" placeholder="max" value={pwMax} onChange={(e) => setPwMax(e.target.value)} />
          </label>
          <label>
            PRI (µs)
            <input type="number" step="any" placeholder="min" value={priMin} onChange={(e) => setPriMin(e.target.value)} />
            <input type="number" step="any" placeholder="max" value={priMax} onChange={(e) => setPriMax(e.target.value)} />
          </label>
          <label>
            PRI Type
            <select value={priTypeFilter} onChange={(e) => setPriTypeFilter(e.target.value as PriType | "")}>
              <option value="">All</option>
              <option value="fixed">Fixed</option>
              <option value="stagger">Stagger</option>
              <option value="cw">CW</option>
              <option value="xlet">Xlet</option>
            </select>
          </label>
          <label className="inline-field-label">
            <input
              type="checkbox"
              checked={rfRangeMatchingOnly}
              onChange={(e) => setRfRangeMatchingOnly(e.target.checked)}
            />
            RF range matching
          </label>
          <label className="inline-field-label">
            <input
              type="checkbox"
              checked={pwRangeMatchingOnly}
              onChange={(e) => setPwRangeMatchingOnly(e.target.checked)}
            />
            PW range matching
          </label>
          <label className="inline-field-label">
            <input
              type="checkbox"
              checked={priRangeMatchingOnly}
              onChange={(e) => setPriRangeMatchingOnly(e.target.checked)}
            />
            PRI range matching
          </label>
          <label>
            Last tested
            <input type="date" value={lastTestedFrom} onChange={(e) => setLastTestedFrom(e.target.value)} />
            <input type="date" value={lastTestedTo} onChange={(e) => setLastTestedTo(e.target.value)} />
          </label>
          <button type="button" className="link-button" onClick={resetMoreFilters}>
            Reset filters
          </button>
        </div>
      )}

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
          showEngineered={showEngineered}
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
          showEngineered={showEngineered}
        />
      )}

      <RequireRole minimum="editor">
        {!hasSetup ? (
          <p className="hint-text">Add a Source and an EW Group first.</p>
        ) : showForm && canAddMode ? (
          <ModeForm
            emitterId={emitterId}
            ewGroups={ewGroups}
            sources={sources}
            defaultEwGroupId={ewGroupFilter}
            onClose={() => setShowForm(false)}
          />
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
