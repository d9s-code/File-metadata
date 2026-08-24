import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useEmitter } from "../state/hooks/useEmitters";
import { useEwGroups } from "../state/hooks/useEwGroups";
import { useSources } from "../state/hooks/useSources";
import { EwGroupsTable } from "../components/ewGroups/EwGroupsTable";
import { SourcesTable } from "../components/sources/SourcesTable";
import { ModesSection } from "../components/modes/ModesSection";
import { StatusTransitionControls } from "../components/versioning/StatusTransitionControls";
import { EmitterTestHistory } from "../components/testing/EmitterTestHistory";

type Tab = "modes" | "tests";

export function EmitterEditorPage() {
  const { emitterId } = useParams<{ emitterId: string }>();
  const [tab, setTab] = useState<Tab>("modes");
  const { data: emitter, isLoading } = useEmitter(emitterId);
  const { data: ewGroups, isLoading: ewGroupsLoading } = useEwGroups(emitterId ?? "");
  const { data: sources, isLoading: sourcesLoading } = useSources(emitterId ?? "");

  // Auto-expand the setup panel once, only if setup looks incomplete on first load — never
  // force it open/closed again afterward, so it doesn't snap shut on the user mid-interaction
  // the moment they finish adding the first EW Group/Source.
  const [setupOpen, setSetupOpen] = useState(false);
  const autoOpenDecided = useRef(false);
  useEffect(() => {
    if (!ewGroupsLoading && !sourcesLoading && !autoOpenDecided.current) {
      autoOpenDecided.current = true;
      if ((ewGroups ?? []).length === 0 || (sources ?? []).length === 0) {
        setSetupOpen(true);
      }
    }
  }, [ewGroupsLoading, sourcesLoading, ewGroups, sources]);

  if (isLoading || !emitter) return <p>Loading…</p>;

  return (
    <div className="page">
      <h1>
        {emitter.name} {emitter.designation && <span className="muted">({emitter.designation})</span>}
      </h1>
      <div className="status-row">
        <span className={`status-badge status-${emitter.status}`}>{emitter.status}</span>
        <StatusTransitionControls emitterId={emitter.id} status={emitter.status} />
        <Link to={`/emitters/${emitter.id}/versions`}>Version history</Link>
        <Link to={`/ambiguity/emitter/${emitter.id}`}>Ambiguity check</Link>
      </div>
      {emitter.description && <p className="muted">{emitter.description}</p>}

      <div className="tab-bar">
        <button className={tab === "modes" ? "tab active" : "tab"} onClick={() => setTab("modes")}>
          Modes
        </button>
        <button className={tab === "tests" ? "tab active" : "tab"} onClick={() => setTab("tests")}>
          Test History
        </button>
      </div>

      {tab === "modes" && (
        <div>
          <ModesSection emitterId={emitter.id} ewGroups={ewGroups ?? []} sources={sources ?? []} />
          <details
            className="setup-collapse"
            open={setupOpen}
            onToggle={(e) => setSetupOpen(e.currentTarget.open)}
          >
            <summary>EW Groups &amp; Sources setup</summary>
            <EwGroupsTable emitterId={emitter.id} ewGroups={ewGroups ?? []} />
            <SourcesTable emitterId={emitter.id} sources={sources ?? []} ewGroups={ewGroups ?? []} />
          </details>
        </div>
      )}

      {tab === "tests" && <EmitterTestHistory emitterId={emitter.id} />}
    </div>
  );
}
