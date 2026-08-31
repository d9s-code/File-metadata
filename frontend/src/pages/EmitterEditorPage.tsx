import { useEffect, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useEmitter } from "../state/hooks/useEmitters";
import { useEwGroups } from "../state/hooks/useEwGroups";
import { useSources } from "../state/hooks/useSources";
import { EwGroupsTable } from "../components/ewGroups/EwGroupsTable";
import { SourcesTable } from "../components/sources/SourcesTable";
import { ModesSection } from "../components/modes/ModesSection";
import { StatusTransitionControls } from "../components/versioning/StatusTransitionControls";
import { EmitterTestHistory } from "../components/testing/EmitterTestHistory";
import { EntityAuditTrail } from "../components/audit/EntityAuditTrail";
import { LoadingState } from "../components/common/LoadingState";
import { Modal } from "../components/common/Modal";
import { emitterStatusLabel } from "../components/common/emitterStatusLabel";

type Tab = "modes" | "tests" | "audit";

export function EmitterEditorPage() {
  const { emitterId } = useParams<{ emitterId: string }>();
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState<Tab>(searchParams.get("tab") === "tests" ? "tests" : "modes");
  const highlightTestRecordId = searchParams.get("testRecord") ?? undefined;

  // useState's initializer only runs on mount, but a Test-Derived badge links
  // to ?tab=tests while already on this page (same route, no remount) — so
  // react to the param changing too, not just its value at mount time.
  useEffect(() => {
    if (searchParams.get("tab") === "tests") setTab("tests");
  }, [searchParams]);
  const { data: emitter, isLoading } = useEmitter(emitterId);
  const { data: ewGroups, isLoading: ewGroupsLoading } = useEwGroups(emitterId ?? "");
  const { data: sources, isLoading: sourcesLoading } = useSources(emitterId ?? "");

  // Auto-expand the setup panel once, only if setup looks incomplete on first load — never
  // force it open/closed again afterward, so it doesn't snap shut on the user mid-interaction
  // the moment they finish adding the first EW Group/Source.
  const [showReworkNote, setShowReworkNote] = useState(false);
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

  if (isLoading || !emitter) return <LoadingState label="Loading emitter…" />;

  return (
    <div className="page">
      <h1>
        {emitter.name} {emitter.designation && <span className="muted">({emitter.designation})</span>}
      </h1>
      <div className="status-row">
        <span className={`status-badge status-${emitter.status}`}>{emitterStatusLabel(emitter.status)}</span>
        {emitter.status === "deprecated" && emitter.rework_note && (
          <button className="rework-note-button" onClick={() => setShowReworkNote(true)}>
            ⚠ View rework note
          </button>
        )}
        <StatusTransitionControls emitterId={emitter.id} status={emitter.status} />
        <Link to={`/emitters/${emitter.id}/versions`}>Version history</Link>
        <Link to={`/ambiguity/emitter/${emitter.id}`}>Ambiguity check</Link>
      </div>
      {emitter.description && <p className="muted">{emitter.description}</p>}

      {showReworkNote && (
        <Modal title="Needs rework" onClose={() => setShowReworkNote(false)}>
          <p>{emitter.rework_note}</p>
        </Modal>
      )}

      {(emitter.summary.mode_count > 0 || emitter.summary.scan_min != null) && (
        <div className="emitter-summary-row" title="RF/PW/PRI computed across this Emitter's approved Modes only; Scan across its EW Groups">
          {emitter.summary.rf_min_mhz != null && (
            <span>
              RF <strong>{emitter.summary.rf_min_mhz}–{emitter.summary.rf_max_mhz}</strong> MHz
            </span>
          )}
          {emitter.summary.pw_min_us != null && (
            <span>
              PW <strong>{emitter.summary.pw_min_us}–{emitter.summary.pw_max_us}</strong> µs
            </span>
          )}
          {emitter.summary.pri_min_us != null && (
            <span>
              PRI <strong>{emitter.summary.pri_min_us}–{emitter.summary.pri_max_us}</strong> µs
            </span>
          )}
          {emitter.summary.scan_min != null && (
            <span>
              Scan <strong>{emitter.summary.scan_min}–{emitter.summary.scan_max}</strong>
            </span>
          )}
          {emitter.summary.mode_count > 0 && (
            <span>
              <strong>
                {emitter.summary.modes_passing} / {emitter.summary.mode_count}
              </strong>{" "}
              Modes passing their last test
            </span>
          )}
        </div>
      )}

      <div className="tab-bar">
        <button className={tab === "modes" ? "tab active" : "tab"} onClick={() => setTab("modes")}>
          Modes
        </button>
        <button className={tab === "tests" ? "tab active" : "tab"} onClick={() => setTab("tests")}>
          Test History
        </button>
        <button className={tab === "audit" ? "tab active" : "tab"} onClick={() => setTab("audit")}>
          Audit
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

      {tab === "tests" && (
        <EmitterTestHistory
          emitterId={emitter.id}
          ewGroups={ewGroups ?? []}
          sources={sources ?? []}
          highlightTestRecordId={highlightTestRecordId}
        />
      )}
      {tab === "audit" && <EntityAuditTrail entityType="emitter" entityId={emitter.id} emitterId={emitter.id} />}
    </div>
  );
}
