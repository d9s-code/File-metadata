import { useState } from "react";
import type { EwGroup, Source } from "../../types/domain";
import { useModes } from "../../state/hooks/useModes";
import { useDeleteEwGroup } from "../../state/hooks/useEwGroups";
import { ModeForm } from "../modes/ModeForm";
import { ModeLinesTable } from "../modes/ModeLinesTable";
import { RequireRole } from "../../auth/RequireAuth";

export function EwGroupPanel({
  emitterId,
  ewGroup,
  sources,
}: {
  emitterId: string;
  ewGroup: EwGroup;
  sources: Source[];
}) {
  const { data: modes } = useModes(ewGroup.id);
  const deleteEwGroup = useDeleteEwGroup(emitterId);
  const [showForm, setShowForm] = useState(false);

  const sourcesById = Object.fromEntries(sources.map((s) => [s.id, s]));

  return (
    <section className="card ew-group-panel">
      <header className="ew-group-header">
        <h3>{ewGroup.name}</h3>
        <div className="ew-group-meta">
          <span>Scan: {ewGroup.scan_min ?? "—"}–{ewGroup.scan_max ?? "—"}</span>
          {ewGroup.scan_delta != null && (
            <span className="hint-text">
              engineered: {ewGroup.engineered_scan_min}–{ewGroup.engineered_scan_max} (±{ewGroup.scan_delta})
            </span>
          )}
          <span>Threat priority: {ewGroup.threat_priority ?? "—"}</span>
        </div>
        <RequireRole minimum="editor">
          <button className="link-button" onClick={() => void deleteEwGroup.mutateAsync(ewGroup.id)}>
            Delete group
          </button>
        </RequireRole>
      </header>

      <ModeLinesTable ewGroupId={ewGroup.id} modes={modes ?? []} sourcesById={sourcesById} />

      <RequireRole minimum="editor">
        {showForm ? (
          <ModeForm ewGroupId={ewGroup.id} sources={sources} />
        ) : (
          <button onClick={() => setShowForm(true)} disabled={sources.length === 0}>
            {sources.length === 0 ? "Add a Source first" : "+ Add Mode"}
          </button>
        )}
      </RequireRole>
    </section>
  );
}
