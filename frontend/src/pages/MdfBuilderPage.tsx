import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useMdf, useMdfLinks, useUpdateMdf } from "../state/hooks/useMdfs";
import { useCommitMdfVersion, useMdfVersions } from "../state/hooks/useMdfVersions";
import { usePlatforms } from "../state/hooks/usePlatforms";
import { useCustomers } from "../state/hooks/useCustomers";
import { useCreateMdfNote, useDeleteMdfNote, useMdfNotes } from "../state/hooks/useMdfNotes";
import { MdfLinkTable } from "../components/mdf/MdfLinkTable";
import { MdfCharts } from "../components/platform/PlatformCharts";
import { PlatformVersionPicker } from "../components/mdf/PlatformVersionPicker";
import { MdfStatusTransitionControls } from "../components/mdf/MdfStatusTransitionControls";
import { downloadMdfXml } from "../components/mdf/ExportXmlButton";
import { downloadPrs } from "../components/versioning/ExportPrsButton";
import { LatestVersion, SaveVersionButton } from "../components/versioning/SaveVersionButton";
import { EntityHeader } from "../components/common/EntityHeader";
import { MenuButton } from "../components/common/MenuButton";
import { ApiRequestError } from "../api/client";
import { MdfTestHistory } from "../components/testing/MdfTestHistory";
import { EntityAuditTrail } from "../components/audit/EntityAuditTrail";
import { RequireRole, useHasRole } from "../auth/RequireAuth";
import { LoadingState } from "../components/common/LoadingState";
import { Modal } from "../components/common/Modal";
import { NotesFeed } from "../components/common/NotesFeed";
import { statusLabel } from "../components/common/emitterStatusLabel";
import { TasksButton } from "../components/tasks/TasksButton";

type Tab = "platforms" | "charts" | "tests" | "audit";

export function MdfBuilderPage() {
  const { mdfId } = useParams<{ mdfId: string }>();
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState<Tab>(searchParams.get("tab") === "tests" ? "tests" : "platforms");
  const highlightTestRecordId = searchParams.get("testRecord") ?? undefined;

  useEffect(() => {
    if (searchParams.get("tab") === "tests") setTab("tests");
  }, [searchParams]);

  const { data: mdf, isLoading } = useMdf(mdfId);
  const { data: links } = useMdfLinks(mdfId ?? "");
  const { data: platforms } = usePlatforms();
  const { data: versions } = useMdfVersions(mdfId ?? "");
  const commitVersion = useCommitMdfVersion(mdfId ?? "");
  const canWrite = useHasRole("editor");
  const [exportError, setExportError] = useState<string | null>(null);
  const { data: customers } = useCustomers();
  const { mutate: updateMdf, isPending: isUpdating } = useUpdateMdf();
  const { data: mdfNotes, isLoading: notesLoading } = useMdfNotes(mdfId ?? "");
  const { mutateAsync: createMdfNote, isPending: isAddingNote } = useCreateMdfNote(mdfId ?? "");
  const { mutateAsync: deleteMdfNote } = useDeleteMdfNote(mdfId ?? "");

  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editReleaseDate, setEditReleaseDate] = useState("");
  const [editCustomerId, setEditCustomerId] = useState("");

  if (isLoading || !mdf) return <LoadingState label="Loading MDF…" />;

  const platformsById = Object.fromEntries((platforms ?? []).map((p) => [p.id, p]));
  const latestVersion = versions && versions.length > 0 ? versions[versions.length - 1] : null;

  const handleStartEdit = () => {
    setEditName(mdf.name);
    setEditDescription(mdf.description ?? "");
    setEditNotes(mdf.notes ?? "");
    setEditReleaseDate(mdf.release_date ?? "");
    setEditCustomerId(mdf.customer_id ?? "");
    setIsEditing(true);
  };

  const handleCancelEdit = () => setIsEditing(false);

  async function runExport(download: () => Promise<void>) {
    setExportError(null);
    try {
      await download();
    } catch (err) {
      setExportError(err instanceof ApiRequestError ? err.message : "Export failed");
    }
  }

  const handleSaveEdit = () => {
    updateMdf(
      {
        id: mdf.id,
        input: {
          name: editName,
          description: editDescription || undefined,
          notes: editNotes || undefined,
          release_date: editReleaseDate || null,
          customer_id: editCustomerId || null,
        },
      },
      { onSuccess: () => setIsEditing(false) },
    );
  };

  return (
    <div className="page">
      <EntityHeader
        title={mdf.name}
        actions={
          <>
            <SaveVersionButton
              noun="MDF"
              save={(summary) => commitVersion.mutateAsync(summary)}
              pending={commitVersion.isPending}
            />
            <MenuButton
              label="Export ▾"
              items={
                latestVersion
                  ? [
                      {
                        label: `XML (v${latestVersion.version_number})`,
                        onSelect: () => void runExport(() => downloadMdfXml(mdf.id, latestVersion.version_number)),
                      },
                      {
                        label: `PRS package (v${latestVersion.version_number})`,
                        onSelect: () => void runExport(() => downloadPrs("mdf", mdf.id, latestVersion.version_number)),
                      },
                    ]
                  : [{ label: "Save a version first — exports come from a saved version", disabled: true }]
              }
            />
            <MenuButton
              label="More ▾"
              items={[
                { label: "Version history", to: `/mdfs/${mdf.id}/versions` },
                { label: "Ambiguity check", to: `/ambiguity/mdf/${mdf.id}` },
                ...(canWrite ? [{ label: "Edit details", onSelect: handleStartEdit }] : []),
              ]}
            />
          </>
        }
        status={
          <>
            <span className={`status-badge status-${mdf.status}`}>{statusLabel(mdf.status)}</span>
            <MdfStatusTransitionControls mdfId={mdf.id} status={mdf.status} />
            <LatestVersion versions={versions} />
            <TasksButton type="mdf" id={mdf.id} name={mdf.name} />
            {exportError && <span className="error-text">{exportError}</span>}
          </>
        }
      >
        {mdf.description && <p className="muted emitter-description">{mdf.description}</p>}
        {mdf.notes && <p className="muted emitter-description">{mdf.notes}</p>}
      </EntityHeader>

      <section className="card">
        <h4>Analyst notes</h4>
        <NotesFeed
          notes={mdfNotes}
          isLoading={notesLoading}
          placeholder="Your own running notes/observations about this MDF — what changed in this release, what to check — separate from the description."
          onAdd={(body) => createMdfNote(body)}
          isAdding={isAddingNote}
          onDelete={(noteId) => deleteMdfNote(noteId)}
        />
      </section>

      {isEditing && (
        <Modal title="Edit details" onClose={handleCancelEdit} wide>
          <div className="edit-fields">
            <label>
              Name
              <input
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                placeholder="MDF Name"
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
                rows={4}
              />
            </label>
            <label>
              Notes
              <textarea
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
                placeholder="Notes"
                className="edit-input"
                rows={4}
              />
            </label>
            <label>
              Release date
              <input
                type="date"
                value={editReleaseDate}
                onChange={(e) => setEditReleaseDate(e.target.value)}
                className="edit-input"
              />
            </label>
            <label>
              Customer
              <select
                value={editCustomerId}
                onChange={(e) => setEditCustomerId(e.target.value)}
                className="edit-input"
              >
                <option value="">— none —</option>
                {(customers ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
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
        <button className={tab === "platforms" ? "tab active" : "tab"} onClick={() => setTab("platforms")}>
          Pinned Platforms
        </button>
        <button className={tab === "charts" ? "tab active" : "tab"} onClick={() => setTab("charts")}>
          Charts
        </button>
        <button className={tab === "tests" ? "tab active" : "tab"} onClick={() => setTab("tests")}>
          Test History
        </button>
        <button className={tab === "audit" ? "tab active" : "tab"} onClick={() => setTab("audit")}>
          Audit
        </button>
      </div>

      {tab === "platforms" && (
        <div>
          <MdfLinkTable mdfId={mdf.id} links={links ?? []} platformsById={platformsById} />
          <RequireRole minimum="editor">
            <h4>Pin a Platform Version</h4>
            <p className="hint-text">
              Pinning needs a saved version of the Platform (and of each Emitter it pins).
            </p>
            <PlatformVersionPicker mdfId={mdf.id} />
          </RequireRole>
        </div>
      )}

      {tab === "charts" && <MdfCharts mdfId={mdf.id} />}
      {tab === "tests" && <MdfTestHistory mdfId={mdf.id} highlightTestRecordId={highlightTestRecordId} />}
      {tab === "audit" && <EntityAuditTrail entityType="mdf" entityId={mdf.id} />}
    </div>
  );
}
