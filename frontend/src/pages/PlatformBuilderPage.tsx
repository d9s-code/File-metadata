import { useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { usePlatform, usePlatformLinks, useRepinPlatformLatest, useUpdatePlatform } from "../state/hooks/usePlatforms";
import { useCommitPlatformVersion, usePlatformVersions } from "../state/hooks/usePlatformVersions";
import { useEmitters } from "../state/hooks/useEmitters";
import { isOutdatedPin, platformsApi } from "../api/platforms";
import { PlatformLinkTable } from "../components/platform/PlatformLinkTable";
import { PinEmittersDialog } from "../components/platform/PinEmittersDialog";
import { EntityAuditTrail } from "../components/audit/EntityAuditTrail";
import { RequireRole, useHasRole } from "../auth/RequireAuth";
import { LoadingState } from "../components/common/LoadingState";
import { Modal } from "../components/common/Modal";
import { MenuButton } from "../components/common/MenuButton";
import { EntityHeader } from "../components/common/EntityHeader";
import { PlatformDwells } from "../components/dwells/PlatformDwells";
import { LatestVersion, SaveVersionButton } from "../components/versioning/SaveVersionButton";
import { TasksButton } from "../components/tasks/TasksButton";
import { MilestonesButton } from "../components/status/MilestonesButton";
import { PlatformStatusControls } from "../components/platform/PlatformStatusControls";
import { NotesFeed } from "../components/common/NotesFeed";
import { NotesDrawer } from "../components/common/NotesDrawer";
import { PlatformCharts } from "../components/platform/PlatformCharts";
import { PlatformTests } from "../components/platform/PlatformTests";
import { useCreatePlatformNote, useDeletePlatformNote, usePlatformNotes } from "../state/hooks/usePlatformNotes";
import { useAttachments } from "../state/hooks/useAttachments";
import { FilesPanel } from "../components/files/FilesPanel";

type Tab = "emitters" | "charts" | "dwells" | "tests" | "files" | "audit";
const TABS: Tab[] = ["emitters", "charts", "dwells", "tests", "files", "audit"];

export function PlatformBuilderPage() {
  const { platformId } = useParams<{ platformId: string }>();
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState<Tab>(() => {
    const t = searchParams.get("tab") as Tab | null;
    return t && TABS.includes(t) ? t : "emitters";
  });
  const { data: platform, isLoading } = usePlatform(platformId);
  const { data: links } = usePlatformLinks(platformId ?? "");
  const repinAll = useRepinPlatformLatest(platformId ?? "");
  const { data: emitters } = useEmitters();
  const commitVersion = useCommitPlatformVersion(platformId ?? "");
  const { data: versions } = usePlatformVersions(platformId ?? "");
  const canWrite = useHasRole("editor");
  const { mutate: updatePlatform, isPending: isUpdating } = useUpdatePlatform();
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [pinning, setPinning] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const { data: notes, isLoading: notesLoading } = usePlatformNotes(platformId ?? "");
  const { mutateAsync: createNote, isPending: isAddingNote } = useCreatePlatformNote(platformId ?? "");
  const { mutateAsync: deleteNote } = useDeletePlatformNote(platformId ?? "");
  const { data: files } = useAttachments("platform", platformId ?? "");

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
            <MenuButton
              label="⋯"
              className="button secondary more-button"
              ariaLabel="More actions"
              title="More actions"
              items={[
                { label: isExporting ? "Exporting…" : "Export XML", onSelect: () => void handleExportXml(), disabled: isExporting },
                { label: "Version history", to: `/platforms/${platform.id}/versions` },
                { label: "Ambiguity check", to: `/ambiguity/platform/${platform.id}` },
                ...(canWrite ? [{ label: "Edit details", onSelect: handleStartEdit }] : []),
              ]}
            />
          </>
        }
        status={
          <>
            <PlatformStatusControls platformId={platform.id} status={platform.status} />
            <LatestVersion versions={versions} />
            <TasksButton type="platform" id={platform.id} name={platform.name} />
            <MilestonesButton type="platform" id={platform.id} status={platform.status} />
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
          Pinned Emitters {links && <span className="tab-count">{links.length}</span>}
        </button>
        <button className={tab === "charts" ? "tab active" : "tab"} onClick={() => setTab("charts")}>
          Charts
        </button>
        <button className={tab === "dwells" ? "tab active" : "tab"} onClick={() => setTab("dwells")}>
          Dwells
        </button>
        <button className={tab === "tests" ? "tab active" : "tab"} onClick={() => setTab("tests")}>
          Tests
        </button>
        <button className={tab === "files" ? "tab active" : "tab"} onClick={() => setTab("files")}>
          Files <span className="tab-count">{files?.length ?? 0}</span>
        </button>
        <button className={tab === "audit" ? "tab active" : "tab"} onClick={() => setTab("audit")}>
          Audit
        </button>
      </div>

      {tab === "emitters" && (
        <section className="card">
          <div className="card-header">
            <h4>
              Pinned Emitters <span className="hint-text">{links?.length ?? 0}</span>
            </h4>
            <div className="section-actions">
            {outdatedPins > 0 && (
              <span className="hint-text">
                {outdatedPins} pinned Emitter{outdatedPins === 1 ? " has" : "s have"} a newer saved version.
              </span>
            )}
            <RequireRole minimum="editor">
              {outdatedPins > 0 && (
                <button
                  type="button"
                  className="button secondary small"
                  disabled={repinAll.isPending}
                  onClick={() => void repinAll.mutateAsync()}
                >
                  {repinAll.isPending ? "Repinning…" : "Repin all to their latest version"}
                </button>
              )}
              <button type="button" className="button primary small" onClick={() => setPinning(true)}>
                + Pin Emitters
              </button>
            </RequireRole>
            </div>
          </div>
          <PlatformLinkTable platformId={platform.id} links={links ?? []} emittersById={emittersById} />
          {pinning && <PinEmittersDialog platformId={platform.id} onClose={() => setPinning(false)} />}
        </section>
      )}

      {tab === "charts" && <PlatformCharts platformId={platform.id} />}

      {tab === "dwells" && <PlatformDwells platformId={platform.id} platformName={platform.name} />}

      {tab === "tests" && <PlatformTests platformId={platform.id} pinnedCount={links?.length ?? 0} />}

      <NotesDrawer count={notes?.length ?? 0} subject={platform.name} draftKey={`notes-draft:platform:${platform.id}`}>
        <NotesFeed
          key={platform.id}
          draftKey={`notes-draft:platform:${platform.id}`}
          notes={notes}
          isLoading={notesLoading}
          placeholder="Your own running notes/observations about this Platform — separate from the description."
          onAdd={(body) => createNote(body)}
          isAdding={isAddingNote}
          onDelete={(noteId) => deleteNote(noteId)}
          inDrawer
        />
      </NotesDrawer>

      {tab === "files" && (
        <FilesPanel
          owner="platform"
          ownerId={platform.id}
          ownerName={platform.name}
          canEdit={canWrite && !platform.deleted_at}
          readOnlyReason={platform.deleted_at ? "In the Trash — restore it to change its files." : undefined}
        />
      )}
      {tab === "audit" && <EntityAuditTrail entityType="platform" entityId={platform.id} />}
    </div>
  );
}
