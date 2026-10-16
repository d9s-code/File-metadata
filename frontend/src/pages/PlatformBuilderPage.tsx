import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { usePlatform, usePlatformLinks, useRepinPlatformLatest, useUpdatePlatform } from "../state/hooks/usePlatforms";
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
import { PlatformDwells } from "../components/dwells/PlatformDwells";
import { LatestVersion, SaveVersionButton } from "../components/versioning/SaveVersionButton";
import { TasksButton } from "../components/tasks/TasksButton";
import { StatusBadge } from "../components/status/StatusBadge";
import { MilestonesButton } from "../components/status/MilestonesButton";
import { PlatformStatusControls } from "../components/platform/PlatformStatusControls";
import { NotesFeed } from "../components/common/NotesFeed";
import { NotesDrawer } from "../components/common/NotesDrawer";
import { PlatformCharts } from "../components/platform/PlatformCharts";
import { PlatformTests } from "../components/platform/PlatformTests";
import { useCreatePlatformNote, useDeletePlatformNote, usePlatformNotes } from "../state/hooks/usePlatformNotes";

type Tab = "emitters" | "charts" | "dwells" | "tests" | "audit";
const TABS: Tab[] = ["emitters", "charts", "dwells", "tests", "audit"];

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
            <StatusBadge type="platform" status={platform.status} />
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
          Pinned Emitters
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
        <button className={tab === "audit" ? "tab active" : "tab"} onClick={() => setTab("audit")}>
          Audit
        </button>
      </div>

      {tab === "emitters" && (
        <div>
          {outdatedPins > 0 && (
            <RequireRole minimum="editor">
              <p className="repin-all-row">
                <span className="hint-text">
                  {outdatedPins} pinned Emitter{outdatedPins === 1 ? " has" : "s have"} a newer saved version.
                </span>{" "}
                <button
                  type="button"
                  className="button secondary small"
                  disabled={repinAll.isPending}
                  onClick={() => void repinAll.mutateAsync()}
                >
                  {repinAll.isPending ? "Repinning…" : "Repin all to their latest version"}
                </button>
              </p>
            </RequireRole>
          )}
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

      {tab === "audit" && <EntityAuditTrail entityType="platform" entityId={platform.id} />}
    </div>
  );
}
