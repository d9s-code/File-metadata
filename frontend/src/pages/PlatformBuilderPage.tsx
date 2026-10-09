import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { usePlatform, usePlatformLinks, useUpdatePlatform } from "../state/hooks/usePlatforms";
import { useCommitPlatformVersion, usePlatformVersions } from "../state/hooks/usePlatformVersions";
import { useEmitters } from "../state/hooks/useEmitters";
import { isOutdatedPin, platformsApi } from "../api/platforms";
import { PlatformLinkTable } from "../components/platform/PlatformLinkTable";
import { PlatformEmitterVersionPicker } from "../components/platform/PlatformEmitterVersionPicker";
import { EntityAuditTrail } from "../components/audit/EntityAuditTrail";
import { RequireRole, useHasRole } from "../auth/RequireAuth";
import { LoadingState } from "../components/common/LoadingState";
import { Modal } from "../components/common/Modal";
import { MenuButton } from "../components/common/MenuButton";
import { EntityHeader } from "../components/common/EntityHeader";
import { LatestVersion, SaveVersionButton } from "../components/versioning/SaveVersionButton";
import { TasksButton } from "../components/tasks/TasksButton";
import { NotesFeed } from "../components/common/NotesFeed";
import { PlatformCharts } from "../components/platform/PlatformCharts";
import { useCreatePlatformNote, useDeletePlatformNote, usePlatformNotes } from "../state/hooks/usePlatformNotes";

type Tab = "emitters" | "charts" | "notes" | "audit";

export function PlatformBuilderPage() {
  const { platformId } = useParams<{ platformId: string }>();
  const [tab, setTab] = useState<Tab>("emitters");
  const { data: platform, isLoading } = usePlatform(platformId);
  const { data: links } = usePlatformLinks(platformId ?? "");
  const { data: emitters } = useEmitters();
  const commitVersion = useCommitPlatformVersion(platformId ?? "");
  const { data: versions } = usePlatformVersions(platformId ?? "");
  const canWrite = useHasRole("editor");
  const { mutate: updatePlatform, isPending: isUpdating } = useUpdatePlatform();
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const { data: notes, isLoading: notesLoading } = usePlatformNotes(platformId ?? "");
  const { mutateAsync: createNote, isPending: isAddingNote } = useCreatePlatformNote(platformId ?? "");
  const { mutateAsync: deleteNote } = useDeletePlatformNote(platformId ?? "");

  if (isLoading || !platform) return <LoadingState label="Loading platform…" />;

  const emittersById = Object.fromEntries((emitters ?? []).map((e) => [e.id, e]));
  const outdatedPins = (links ?? []).filter(isOutdatedPin).length;

  const handleStartEdit = () => {
    setEditName(platform.name);
    setEditDescription(platform.description ?? "");
    setIsEditing(true);
  };

  const handleCancelEdit = () => setIsEditing(false);

  const handleSaveEdit = () => {
    updatePlatform(
      { id: platform.id, input: { name: editName, description: editDescription || undefined } },
      { onSuccess: () => setIsEditing(false) },
    );
  };

  const handleExportXml = async () => {
    setExportError(null);
    try {
      setIsExporting(true);
      const blob = await platformsApi.exportXml(platform.id);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${platform.name}_xml_export.zip`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      a.remove();
    } catch (error) {
      setExportError(error instanceof Error ? `Couldn't export the XML package: ${error.message}` : "Couldn't export the XML package.");
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="page">
      <EntityHeader
        title={platform.name}
        actions={
          <>
            <SaveVersionButton
              noun="Platform"
              save={(summary) => commitVersion.mutateAsync(summary)}
              pending={commitVersion.isPending}
            />
            <Link
              className="link-as-button"
              to={`/ambiguity/platform/${platform.id}`}
              title="Check the saved Platform version's pinned Emitters for Modes that overlap — across Emitters too"
            >
              Ambiguity check
            </Link>
            <button className="button secondary" onClick={() => void handleExportXml()} disabled={isExporting}>
              {isExporting ? "Exporting…" : "Export XML"}
            </button>
            <MenuButton
              label="More ▾"
              items={[
                { label: "Version history", to: `/platforms/${platform.id}/versions` },
                ...(canWrite ? [{ label: "Edit details", onSelect: handleStartEdit }] : []),
              ]}
            />
          </>
        }
        status={
          <>
            <LatestVersion versions={versions} />
            <TasksButton type="platform" id={platform.id} name={platform.name} />
            {outdatedPins > 0 && (
              <button
                className="status-badge status-pending_review"
                onClick={() => setTab("emitters")}
                title="Pinned Emitters with a newer saved version — see the Pinned Emitters tab to repin"
              >
                {outdatedPins} outdated pin{outdatedPins === 1 ? "" : "s"}
              </button>
            )}
            {exportError && <span className="error-text">{exportError}</span>}
          </>
        }
      >
        {platform.description && <p className="muted emitter-description">{platform.description}</p>}
      </EntityHeader>

      {isEditing && (
        <Modal title="Edit details" onClose={handleCancelEdit} wide>
          <div className="edit-fields">
            <label>
              Name
              <input
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                placeholder="Platform Name"
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
          <div className="modal-actions">
            <button className="button secondary" onClick={handleCancelEdit} disabled={isUpdating}>
              Cancel
            </button>
            <button className="button primary" onClick={handleSaveEdit} disabled={isUpdating}>
              {isUpdating ? "Saving…" : "Save"}
            </button>
          </div>
        </Modal>
      )}

      <div className="tab-bar">
        <button className={tab === "emitters" ? "tab active" : "tab"} onClick={() => setTab("emitters")}>
          Pinned Emitters
        </button>
        <button className={tab === "charts" ? "tab active" : "tab"} onClick={() => setTab("charts")}>
          Charts
        </button>
        <button className={tab === "notes" ? "tab active" : "tab"} onClick={() => setTab("notes")}>
          Analyst notes{notes?.length ? ` (${notes.length})` : ""}
        </button>
        <button className={tab === "audit" ? "tab active" : "tab"} onClick={() => setTab("audit")}>
          Audit
        </button>
      </div>

      {tab === "emitters" && (
        <div>
          <PlatformLinkTable platformId={platform.id} links={links ?? []} emittersById={emittersById} />

          <RequireRole minimum="editor">
            <h4>Pin an Emitter Version</h4>
            <p className="hint-text">
              Pinning needs a saved version of the Emitter — if it only has unsaved changes, save a version
              on the Emitter first.
            </p>
            <PlatformEmitterVersionPicker platformId={platform.id} />
          </RequireRole>
        </div>
      )}

      {tab === "charts" && <PlatformCharts platformId={platform.id} />}

      {tab === "notes" && (
        <section className="card">
          <h4>Analyst notes</h4>
          <NotesFeed
            notes={notes}
            isLoading={notesLoading}
            placeholder="Your own running notes/observations about this Platform — separate from the description."
            onAdd={(body) => createNote(body)}
            isAdding={isAddingNote}
            onDelete={(noteId) => deleteNote(noteId)}
          />
        </section>
      )}

      {tab === "audit" && <EntityAuditTrail entityType="platform" entityId={platform.id} />}
    </div>
  );
}
