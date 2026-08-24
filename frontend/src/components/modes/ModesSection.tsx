import { useEffect, useMemo, useState } from "react";
import type { EwGroup, Source } from "../../types/domain";
import { useDeleteMode, useEmitterModes } from "../../state/hooks/useModes";
import { useConfirmDialog } from "../common/ConfirmDialog";
import { ModesTable } from "./ModesTable";
import { ModesCardGrid } from "./ModesCardGrid";
import { ModesViewToggle, type ModesView } from "./ModesViewToggle";
import { ModeForm } from "./ModeForm";
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
  const deleteMode = useDeleteMode(emitterId);
  const { confirmDelete, dialog } = useConfirmDialog();
  const [view, setView] = useState<ModesView>(readStoredView);
  const [ewGroupFilter, setEwGroupFilter] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");
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
    (m) => (!ewGroupFilter || m.ew_group_id === ewGroupFilter) && (!sourceFilter || m.source_id === sourceFilter),
  );

  async function handleDelete(modeId: string, ewGroupId: string, name: string) {
    if (await confirmDelete(`Delete Mode "${name}"?`)) {
      await deleteMode.mutateAsync({ ewGroupId, modeId });
    }
  }

  const canAddMode = ewGroups.length > 0 && sources.length > 0;

  return (
    <section className="card">
      <div className="modes-section-header">
        <h4>Modes</h4>
        <ModesViewToggle view={view} onChange={setView} />
      </div>

      <div className="form-row">
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
      </div>

      {isLoading ? (
        <p className="page-loading">Loading…</p>
      ) : filtered.length === 0 ? (
        <p className="hint-text">
          No Modes yet — add a Source, then either type a DSL line or add Elements and run Cartesian Product.
        </p>
      ) : view === "table" ? (
        <ModesTable modes={filtered} ewGroupsById={ewGroupsById} sourcesById={sourcesById} onDelete={handleDelete} />
      ) : (
        <ModesCardGrid modes={filtered} ewGroupsById={ewGroupsById} sourcesById={sourcesById} onDelete={handleDelete} />
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
