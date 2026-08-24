import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useEmitter } from "../state/hooks/useEmitters";
import { useEwGroups } from "../state/hooks/useEwGroups";
import { useSources } from "../state/hooks/useSources";
import { EwGroupPanel } from "../components/ewGroups/EwGroupPanel";
import { EwGroupForm } from "../components/ewGroups/EwGroupForm";
import { SourceCard } from "../components/sources/SourceCard";
import { SourceForm } from "../components/sources/SourceForm";
import { StatusTransitionControls } from "../components/versioning/StatusTransitionControls";
import { EmitterTestHistory } from "../components/testing/EmitterTestHistory";
import { RequireRole } from "../auth/RequireAuth";

type Tab = "ew-groups" | "sources" | "tests";

export function EmitterEditorPage() {
  const { emitterId } = useParams<{ emitterId: string }>();
  const [tab, setTab] = useState<Tab>("ew-groups");
  const { data: emitter, isLoading } = useEmitter(emitterId);
  const { data: ewGroups } = useEwGroups(emitterId ?? "");
  const { data: sources } = useSources(emitterId ?? "");

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
        <button className={tab === "ew-groups" ? "tab active" : "tab"} onClick={() => setTab("ew-groups")}>
          EW Groups → Modes
        </button>
        <button className={tab === "sources" ? "tab active" : "tab"} onClick={() => setTab("sources")}>
          Sources
        </button>
        <button className={tab === "tests" ? "tab active" : "tab"} onClick={() => setTab("tests")}>
          Test History
        </button>
      </div>

      {tab === "ew-groups" && (
        <div>
          {ewGroups?.map((g) => (
            <EwGroupPanel key={g.id} emitterId={emitter.id} ewGroup={g} sources={sources ?? []} />
          ))}
          <RequireRole minimum="editor">
            <h4>Add EW Group</h4>
            <EwGroupForm emitterId={emitter.id} />
          </RequireRole>
        </div>
      )}

      {tab === "sources" && (
        <div>
          {(sources ?? []).map((s) => (
            <SourceCard key={s.id} emitterId={emitter.id} source={s} ewGroups={ewGroups ?? []} />
          ))}
          <RequireRole minimum="editor">
            <h4>Add Source</h4>
            <SourceForm emitterId={emitter.id} />
          </RequireRole>
        </div>
      )}

      {tab === "tests" && <EmitterTestHistory emitterId={emitter.id} />}
    </div>
  );
}
