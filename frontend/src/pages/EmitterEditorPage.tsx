import { Fragment, useEffect, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useEmitter, useUpdateEmitter } from "../state/hooks/useEmitters";
import { useEmitterCheckoutState } from "../state/hooks/useEmitterCheckout";
import { useEwGroups } from "../state/hooks/useEwGroups";
import { useFunctionGroups } from "../state/hooks/useFunctionGroups";
import { useSources } from "../state/hooks/useSources";
import { useCreateEmitterNote, useDeleteEmitterNote, useEmitterNotes } from "../state/hooks/useEmitterNotes";
import { emittersApi } from "../api/emitters";
import { EwGroupsTable } from "../components/ewGroups/EwGroupsTable";
import { FunctionGroupsTable } from "../components/functionGroups/FunctionGroupsTable";
import { SourcesTable } from "../components/sources/SourcesTable";
import { ModesSection } from "../components/modes/ModesSection";
import { EmitterIntercepts } from "../components/intercepts/EmitterIntercepts";
import { StatusTransitionControls } from "../components/versioning/StatusTransitionControls";
import { CheckoutBanner } from "../components/versioning/CheckoutBanner";
import { EmitterTestHistory } from "../components/testing/EmitterTestHistory";
import { EntityAuditTrail } from "../components/audit/EntityAuditTrail";
import { LoadingState } from "../components/common/LoadingState";
import { Modal } from "../components/common/Modal";
import { NotesFeed } from "../components/common/NotesFeed";
import { emitterStatusLabel } from "../components/common/emitterStatusLabel";
import { JsonImportModal } from "../components/common/JsonImportModal";
import { useQueryClient } from "@tanstack/react-query";

type Tab = "modes" | "setup" | "intercepts" | "tests" | "audit";

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
  const { canEdit } = useEmitterCheckoutState(emitter);
  const { data: ewGroups, isLoading: ewGroupsLoading } = useEwGroups(emitterId ?? "");
  const { data: functionGroups } = useFunctionGroups(emitterId ?? "");
  const { data: sources, isLoading: sourcesLoading } = useSources(emitterId ?? "");
  const queryClient = useQueryClient();
  const { mutate: updateEmitter, isPending: isUpdating } = useUpdateEmitter();
  const { data: emitterNotes, isLoading: notesLoading } = useEmitterNotes(emitterId ?? "");
  const { mutateAsync: createEmitterNote, isPending: isAddingNote } = useCreateEmitterNote(emitterId ?? "");
  const { mutateAsync: deleteEmitterNote } = useDeleteEmitterNote(emitterId ?? "");

  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDesignation, setEditDesignation] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  // Bumped after "Discard changes" to remount every tab, so open edit forms
  // and other local state holding discarded values are thrown away too.
  const [contentVersion, setContentVersion] = useState(0);

  // Auto-switch to the Setup tab once, only if setup looks incomplete on first load — never
  // force a tab switch again afterward, so it doesn't yank the user away mid-interaction the
  // moment they finish adding the first EW Group/Source.
  const [showReworkNote, setShowReworkNote] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const autoOpenDecided = useRef(false);
  useEffect(() => {
    if (!ewGroupsLoading && !sourcesLoading && !autoOpenDecided.current) {
      autoOpenDecided.current = true;
      if (searchParams.get("tab") !== "tests" && ((ewGroups ?? []).length === 0 || (sources ?? []).length === 0)) {
        setTab("setup");
      }
    }
  }, [ewGroupsLoading, sourcesLoading, ewGroups, sources, searchParams]);

  if (isLoading || !emitter) return <LoadingState label="Loading emitter…" />;

  // Only shown while genuinely incomplete — once there's at least one
  // Source, one EW Group, and one Mode, this disappears entirely rather
  // than lingering as clutter on a mature Emitter.
  const sourceCount = sources?.length ?? 0;
  const ewGroupCount = ewGroups?.length ?? 0;
  const modeCount = emitter.summary.mode_count;
  const setupIncomplete = sourceCount === 0 || ewGroupCount === 0 || modeCount === 0;

  const handleStartEdit = () => {
    setEditName(emitter.name);
    setEditDesignation(emitter.designation ?? "");
    setEditDescription(emitter.description ?? "");
    setIsEditing(true);
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
  };

  const handleExportXml = async () => {
    try {
      const blob = await emittersApi.exportXml(emitter.id, { responseType: "blob" });
      const url = window.URL.createObjectURL(blob as Blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${emitter.name}_xml_export.zip`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      a.remove();
    } catch (err) {
      alert("Failed to export XML archive.");
      console.error(err);
    }
  };

  const handleSaveEdit = () => {
    updateEmitter(
      {
        id: emitter.id,
        input: { name: editName, designation: editDesignation || undefined, description: editDescription || undefined },
      },
      {
        onSuccess: () => setIsEditing(false),
      }
    );
  };

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
        <button
          className="button secondary small"
          disabled={!canEdit}
          title={canEdit ? undefined : "Start editing this Emitter first"}
          onClick={handleStartEdit}
        >
          Edit Name/Designation/Description
        </button>
        <button className="button secondary small" onClick={handleExportXml}>
          Export XML
        </button>
      </div>
      {emitter.description && <p className="muted">{emitter.description}</p>}

      {isEditing && (
        <Modal title="Edit Name/Designation/Description" onClose={handleCancelEdit} wide>
          <div className="edit-fields">
            <label>
              Name
              <input
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                placeholder="Emitter Name"
                className="edit-input"
              />
            </label>
            <label>
              Designation
              <input
                type="text"
                value={editDesignation}
                onChange={(e) => setEditDesignation(e.target.value)}
                placeholder="Designation"
                className="edit-input"
              />
            </label>
            <label>
              Description
              <textarea
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                placeholder="Description"
                className="edit-input"
                rows={12}
              />
            </label>
          </div>
          <div className="edit-actions">
            <button className="button primary" onClick={handleSaveEdit} disabled={isUpdating}>
              {isUpdating ? "Saving..." : "Save"}
            </button>
            <button className="button" onClick={handleCancelEdit} disabled={isUpdating}>
              Cancel
            </button>
          </div>
        </Modal>
      )}

      <CheckoutBanner emitter={emitter} onDiscarded={() => setContentVersion((v) => v + 1)} />

      <p className="validation-headline">
        Last validated against simulation:{" "}
        {emitter.last_validated_at ? (
          <>
            {emitter.last_validated_at}{" "}
            <span className={`test-result-badge test-result-${emitter.last_validated_result}`}>
              {emitter.last_validated_result}
            </span>{" "}
            <button type="button" className="link-button" onClick={() => setTab("tests")}>
              view
            </button>
          </>
        ) : (
          <>
            not yet —{" "}
            <button type="button" className="link-button" onClick={() => setTab("tests")}>
              import SIM Test Lines and log a test
            </button>
          </>
        )}
      </p>

      {!ewGroupsLoading && !sourcesLoading && setupIncomplete && (
        <div className="setup-progress-banner">
          <span className={sourceCount > 0 ? "setup-step-done" : "setup-step-todo"}>
            {sourceCount > 0 ? "✓" : "○"} {sourceCount} Source{sourceCount === 1 ? "" : "s"}
          </span>
          <span className={ewGroupCount > 0 ? "setup-step-done" : "setup-step-todo"}>
            {ewGroupCount > 0 ? "✓" : "○"} {ewGroupCount} EW Group{ewGroupCount === 1 ? "" : "s"}
          </span>
          <span className={modeCount > 0 ? "setup-step-done" : "setup-step-todo"}>
            {modeCount > 0 ? "✓" : "○"} {modeCount} Mode{modeCount === 1 ? "" : "s"}
          </span>
          {" — "}
          {sourceCount === 0 || ewGroupCount === 0 ? (
            <button type="button" className="link-button" onClick={() => setTab("setup")}>
              set up EW Groups & Sources before testing anything
            </button>
          ) : (
            <button type="button" className="link-button" onClick={() => setTab("modes")}>
              add a Mode to start testing
            </button>
          )}
        </div>
      )}

      {!isEditing && (
        <details
          className="setup-collapse"
          open={notesOpen}
          onToggle={(e) => setNotesOpen(e.currentTarget.open)}
        >
          <summary>Analyst notes{emitterNotes && emitterNotes.length > 0 ? ` (${emitterNotes.length})` : ""}</summary>
          <div className="card">
            <NotesFeed
              notes={emitterNotes}
              isLoading={notesLoading}
              placeholder="Your own running notes/observations about this Emitter — separate from the description."
              onAdd={(body) => createEmitterNote(body)}
              isAdding={isAddingNote}
              onDelete={(noteId) => deleteEmitterNote(noteId)}
            />
          </div>
        </details>
      )}

      {showReworkNote && (
        <Modal title="Needs rework" onClose={() => setShowReworkNote(false)}>
          <p>{emitter.rework_note}</p>
        </Modal>
      )}

      {(emitter.summary.mode_count > 0 || emitter.summary.scan_min != null) && (
        <div className="emitter-summary-row" title="RF/PW/PRI computed across this Emitter's Modes; Scan across its EW Groups">
          {emitter.summary.rf_min_mhz != null && (
            <span>
              RF <strong>{emitter.summary.rf_min_mhz}–{emitter.summary.rf_max_mhz}</strong> MHz
              {(emitter.summary.engineered_rf_min_mhz !== emitter.summary.rf_min_mhz ||
                emitter.summary.engineered_rf_max_mhz !== emitter.summary.rf_max_mhz) && (
                <span className="hint-text">
                  {" "}
                  · engineered: {emitter.summary.engineered_rf_min_mhz}–{emitter.summary.engineered_rf_max_mhz}
                </span>
              )}
            </span>
          )}
          {emitter.summary.pw_min_us != null && (
            <span>
              PW <strong>{emitter.summary.pw_min_us}–{emitter.summary.pw_max_us}</strong> µs
              {(emitter.summary.engineered_pw_min_us !== emitter.summary.pw_min_us ||
                emitter.summary.engineered_pw_max_us !== emitter.summary.pw_max_us) && (
                <span className="hint-text">
                  {" "}
                  · engineered: {emitter.summary.engineered_pw_min_us}–{emitter.summary.engineered_pw_max_us}
                </span>
              )}
            </span>
          )}
          {emitter.summary.pri_min_us != null && (
            <span>
              PRI <strong>{emitter.summary.pri_min_us}–{emitter.summary.pri_max_us}</strong> µs
              {(emitter.summary.engineered_pri_min_us !== emitter.summary.pri_min_us ||
                emitter.summary.engineered_pri_max_us !== emitter.summary.pri_max_us) && (
                <span className="hint-text">
                  {" "}
                  · engineered: {emitter.summary.engineered_pri_min_us}–{emitter.summary.engineered_pri_max_us}
                </span>
              )}
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
        <button className={tab === "setup" ? "tab active" : "tab"} onClick={() => setTab("setup")}>
          EW Groups & Sources
        </button>
        <button className={tab === "intercepts" ? "tab active" : "tab"} onClick={() => setTab("intercepts")}>
          Intercepts
        </button>
        <button className={tab === "tests" ? "tab active" : "tab"} onClick={() => setTab("tests")}>
          Test History
        </button>
        <button className={tab === "audit" ? "tab active" : "tab"} onClick={() => setTab("audit")}>
          Audit
        </button>
      </div>

      {/* All tabs stay mounted — only visibility toggles (`hidden`, not a JSX
          conditional) — so switching tabs never unmounts/resets a Mode search
          filter or an in-progress "New Test" form the user hasn't saved yet. */}
      <Fragment key={contentVersion}>
      <div hidden={tab !== "modes"}>
        <ModesSection
          emitterId={emitter.id}
          ewGroups={ewGroups ?? []}
          sources={sources ?? []}
          functionGroups={functionGroups ?? []}
        />
      </div>

      <div hidden={tab !== "setup"}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h4 style={{ margin: 0 }}>EW Groups & Sources</h4>
          <button className="button" onClick={() => setIsImportModalOpen(true)}>
            Import JSON
          </button>
        </div>
        <EwGroupsTable emitterId={emitter.id} ewGroups={ewGroups ?? []} />
        <FunctionGroupsTable emitterId={emitter.id} functionGroups={functionGroups ?? []} />
        <SourcesTable emitterId={emitter.id} sources={sources ?? []} ewGroups={ewGroups ?? []} />
      </div>

      <div hidden={tab !== "intercepts"}>
        <EmitterIntercepts emitterId={emitter.id} />
      </div>

      <div hidden={tab !== "tests"}>
        <EmitterTestHistory emitterId={emitter.id} highlightTestRecordId={highlightTestRecordId} />
      </div>
      <div hidden={tab !== "audit"}>
        <EntityAuditTrail entityType="emitter" entityId={emitter.id} emitterId={emitter.id} />
      </div>
      </Fragment>

      {isImportModalOpen && (
        <JsonImportModal
          emitterId={emitter.id}
          onClose={() => setIsImportModalOpen(false)}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ["sources", emitter.id] });
          }}
        />
      )}
    </div>
  );
}
