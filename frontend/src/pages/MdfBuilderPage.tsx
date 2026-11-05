import { useEffect, useState } from "react";
import { BackLink } from "../components/common/BackLink";
import { DateInput } from "../components/common/DateInput";
import { useParams, useSearchParams } from "react-router-dom";
import { useMdf, useMdfLinks, useRepinMdfLatest, useUpdateMdf } from "../state/hooks/useMdfs";
import { useCommitMdfVersion, useMdfVersions } from "../state/hooks/useMdfVersions";
import { usePlatforms } from "../state/hooks/usePlatforms";
import { useCustomers } from "../state/hooks/useCustomers";
import { useCreateMdfNote, useDeleteMdfNote, useMdfNotes } from "../state/hooks/useMdfNotes";
import { MdfLinkTable } from "../components/mdf/MdfLinkTable";
import { MdfReadinessPanel, useReadinessCounts } from "../components/mdf/MdfReadinessPanel";
import { isOutdatedMdfPin } from "../api/mdfs";
import { MdfCharts } from "../components/platform/PlatformCharts";
import { PlatformVersionPicker } from "../components/mdf/PlatformVersionPicker";
import { MdfStatusTransitionControls } from "../components/mdf/MdfStatusTransitionControls";
import { downloadPrs } from "../components/versioning/ExportPrsButton";
import { LatestVersion, SaveVersionButton } from "../components/versioning/SaveVersionButton";
import { EntityHeader } from "../components/common/EntityHeader";
import { MenuButton } from "../components/common/MenuButton";
import { ApiRequestError } from "../api/client";
import { MdfTestHistory } from "../components/testing/MdfTestHistory";
import { EntityAuditTrail } from "../components/audit/EntityAuditTrail";
import { RequireRole, useHasRole } from "../auth/RequireAuth";
import { useAttachments } from "../state/hooks/useAttachments";
import { FilesPanel } from "../components/files/FilesPanel";
import { MdfEmittersTable, useMdfCoverage } from "../components/mdf/MdfEmittersTable";
import { downloadMdfReport } from "../components/mdf/mdfReport";
import { UnsavedPinsFlag } from "../components/versioning/UnsavedPinsFlag";
import { MdfPlanChips, MdfPlanPanel } from "../components/mdf/MdfPlanPanel";
import { MdfDwellsPanel } from "../components/mdf/MdfDwellsPanel";
import { useMdfDwells } from "../state/hooks/useDwells";
import { useStatuses } from "../state/hooks/useStatuses";
import { LoadingState } from "../components/common/LoadingState";
import { Modal } from "../components/common/Modal";
import { NotesFeed } from "../components/common/NotesFeed";
import { NotesDrawer } from "../components/common/NotesDrawer";
import { TasksButton } from "../components/tasks/TasksButton";
import { MilestonesButton } from "../components/status/MilestonesButton";

type Tab = "platforms" | "emitters" | "dwells" | "plan" | "charts" | "tests" | "readiness" | "files" | "audit";
const TABS: readonly Tab[] = ["platforms", "emitters", "dwells", "plan", "charts", "tests", "readiness", "files", "audit"];
/** Where each readiness check is dealt with. */
const READINESS_TAB: Record<string, Tab> = {
  pinned: "platforms",
  platform_pins: "platforms",
  emitter_pins: "platforms",
  dwells: "dwells",
  operational: "emitters",
  simulation: "emitters",
  mdf_test: "tests",
};
// The Timeline tab is gone: its history is on the Audit tab, its summary on Plan.
const linkedTab = (t: string | null): Tab | null =>
  t === "timeline" ? "plan" : TABS.includes(t as Tab) ? (t as Tab) : null;

export function MdfBuilderPage() {
  const { mdfId } = useParams<{ mdfId: string }>();
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState<Tab>(linkedTab(searchParams.get("tab")) ?? "platforms");
  const highlightTestRecordId = searchParams.get("testRecord") ?? undefined;

  useEffect(() => {
    const linked = linkedTab(searchParams.get("tab"));
    if (linked) setTab(linked);
  }, [searchParams]);

  const { data: mdf, isLoading } = useMdf(mdfId);
  const { data: links } = useMdfLinks(mdfId ?? "");
  const { data: dwellPins } = useMdfDwells(mdfId ?? "");
  const readiness = useReadinessCounts(mdfId ?? "");
  const repinAll = useRepinMdfLatest(mdfId ?? "");
  const mdfStatuses = useStatuses("mdf");
  // Released (or later): its pins stay as they went out, so a newer Platform version isn't flagged.
  const pinsFrozen = !!mdf && mdfStatuses.atOrAfter(mdf.status, "released");
  const outdatedPins = pinsFrozen ? 0 : (links ?? []).filter(isOutdatedMdfPin).length;
  const { data: platforms } = usePlatforms();
  const { data: versions } = useMdfVersions(mdfId ?? "");
  const commitVersion = useCommitMdfVersion(mdfId ?? "");
  const canWrite = useHasRole("editor");
  const { data: files } = useAttachments("mdf", mdfId ?? "");
  const { data: coverage } = useMdfCoverage(mdfId ?? "");
  const emitterCount = new Set((coverage ?? []).flatMap((p) => p.emitters.map((e) => e.emitter_id))).size;
  const [exportError, setExportError] = useState<string | null>(null);
  const { data: customers } = useCustomers();
  const { mutate: updateMdf, isPending: isUpdating } = useUpdateMdf();
  const { data: mdfNotes, isLoading: notesLoading } = useMdfNotes(mdfId ?? "");
  const { mutateAsync: createMdfNote, isPending: isAddingNote } = useCreateMdfNote(mdfId ?? "");
  const { mutateAsync: deleteMdfNote } = useDeleteMdfNote(mdfId ?? "");

  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [pinningPlatform, setPinningPlatform] = useState(false);
  const [editDescription, setEditDescription] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editReleaseDate, setEditReleaseDate] = useState("");
  const [editDueDate, setEditDueDate] = useState("");
  const [editCustomerId, setEditCustomerId] = useState("");

  if (isLoading || !mdf) return <LoadingState label="Loading MDF…" />;

  const platformsById = Object.fromEntries((platforms ?? []).map((p) => [p.id, p]));
  const latestVersion = versions && versions.length > 0 ? versions[versions.length - 1] : null;

  const handleStartEdit = () => {
    setEditName(mdf.name);
    setEditDescription(mdf.description ?? "");
    setEditNotes(mdf.notes ?? "");
    setEditReleaseDate(mdf.release_date ?? "");
    setEditDueDate(mdf.due_date ?? "");
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
          due_date: editDueDate || null,
          customer_id: editCustomerId || null,
        },
      },
      { onSuccess: () => setIsEditing(false) },
    );
  };

  return (
    <div className="page">
      <BackLink to="/mdfs">MDFs</BackLink>
      <EntityHeader
        title={mdf.name}
        actions={
          <>
            <button
              type="button"
              className="button secondary"
              disabled={!latestVersion}
              title={
                latestVersion
                  ? `The PRS package of v${latestVersion.version_number}: its Platforms, Emitters and dwell files`
                  : "Save a version first — exports come from a saved version"
              }
              onClick={() =>
                latestVersion && void runExport(() => downloadPrs("mdf", mdf.id, latestVersion.version_number))
              }
            >
              Export PRS{latestVersion ? ` (v${latestVersion.version_number})` : ""}
            </button>
            <SaveVersionButton
              noun="MDF"
              save={(summary) => commitVersion.mutateAsync(summary)}
              pending={commitVersion.isPending}
            />
            <MenuButton
              label="⋯"
              className="button secondary more-button"
              ariaLabel="More actions"
              title="More actions"
              items={[
                { label: "Version history", to: `/mdfs/${mdf.id}/versions` },
                { label: "Compare with an earlier version", to: `/mdfs/compare?a=${mdf.id}&b=${mdf.id}` },
                { label: "Compare with another MDF", to: `/mdfs/compare?a=${mdf.id}` },
                { label: "Ambiguity check", to: `/ambiguity/mdf/${mdf.id}` },
                {
                  label: "Download report (.xlsx)",
                  onSelect: () => {
                    setExportError(null);
                    downloadMdfReport(mdf).catch((err) =>
                      setExportError(err instanceof ApiRequestError ? err.message : "Couldn't make the report"),
                    );
                  },
                },
                ...(canWrite ? [{ label: "Edit details", onSelect: handleStartEdit }] : []),
              ]}
            />
          </>
        }
        status={
          <>
            <MdfStatusTransitionControls mdfId={mdf.id} status={mdf.status} />
            <LatestVersion versions={versions} />
            <MdfPlanChips mdf={mdf} done={pinsFrozen} />
            <UnsavedPinsFlag
              kind="mdf"
              id={mdf.id}
              signature={`${(links ?? []).map((l) => `${l.platform_id}:${l.platform_version_id}`).sort().join(",")}|${(dwellPins ?? []).map((d) => `${d.dwell_file_id}:${d.pinned_version_id}`).sort().join(",")}|${versions?.length ?? 0}`}
            />
            <TasksButton type="mdf" id={mdf.id} name={mdf.name} />
            <MilestonesButton type="mdf" id={mdf.id} status={mdf.status} />
            {outdatedPins > 0 && (
              <button
                className="status-badge status-pending_review"
                onClick={() => setTab("platforms")}
                title="Pinned Platforms with a newer saved version — see Pinned Platforms to repin"
              >
                {outdatedPins} outdated pin{outdatedPins === 1 ? "" : "s"}
              </button>
            )}
            {exportError && <span className="error-text">{exportError}</span>}
          </>
        }
      >
        {mdf.description && <p className="muted emitter-description">{mdf.description}</p>}
        {mdf.notes && <p className="muted emitter-description">{mdf.notes}</p>}
      </EntityHeader>

      <NotesDrawer count={mdfNotes?.length ?? 0} subject={mdf.name} draftKey={`notes-draft:mdf:${mdf.id}`}>
        <NotesFeed
          key={mdf.id}
          draftKey={`notes-draft:mdf:${mdf.id}`}
          notes={mdfNotes}
          isLoading={notesLoading}
          placeholder="Your own running notes/observations about this MDF — what changed in this release, what to check — separate from the description."
          onAdd={(body) => createMdfNote(body)}
          isAdding={isAddingNote}
          onDelete={(noteId) => deleteMdfNote(noteId)}
          inDrawer
        />
      </NotesDrawer>

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
              <DateInput
                value={editReleaseDate}
                onChange={(e) => setEditReleaseDate(e.target.value)}
                className="edit-input"
              />
            </label>
            <label>
              Due date
              <DateInput value={editDueDate} onChange={(e) => setEditDueDate(e.target.value)} className="edit-input" />
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
          Pinned Platforms {links && <span className="tab-count">{links.length}</span>}
        </button>
        <button className={tab === "emitters" ? "tab active" : "tab"} onClick={() => setTab("emitters")}>
          Emitters <span className="tab-count">{emitterCount}</span>
        </button>
        <button className={tab === "dwells" ? "tab active" : "tab"} onClick={() => setTab("dwells")}>
          Dwells <span className="tab-count">{dwellPins?.length ?? 0}</span>
          {(dwellPins ?? []).some((d) => d.outdated) && (
            <span className="tab-dot" title="A pinned dwell file has a newer saved version" aria-label="outdated" />
          )}
        </button>
        <button className={tab === "plan" ? "tab active" : "tab"} onClick={() => setTab("plan")}>
          Plan{mdf.goals_total > 0 && <span className="tab-count">{mdf.goals_done}/{mdf.goals_total}</span>}
        </button>
        <button className={tab === "charts" ? "tab active" : "tab"} onClick={() => setTab("charts")}>
          Charts
        </button>
        <button className={tab === "tests" ? "tab active" : "tab"} onClick={() => setTab("tests")}>
          Test History
        </button>
        <button className={tab === "readiness" ? "tab active" : "tab"} onClick={() => setTab("readiness")}>
          Readiness
          {readiness.loaded && (
            <span
              className={`tab-count${readiness.fails ? " tab-count-fail" : readiness.warns ? " tab-count-warn" : " tab-count-ok"}`}
              title={`${readiness.fails} problem(s), ${readiness.warns} warning(s)`}
            >
              {readiness.fails + readiness.warns || "✓"}
            </span>
          )}
        </button>
        <button className={tab === "files" ? "tab active" : "tab"} onClick={() => setTab("files")}>
          Files <span className="tab-count">{files?.length ?? 0}</span>
        </button>
        <button className={tab === "audit" ? "tab active" : "tab"} onClick={() => setTab("audit")}>
          Audit
        </button>
      </div>

      {tab === "platforms" && (
        <div>
          <section className="card">
            <div className="card-header">
              <h2 className="as-h4">
                Pinned Platforms <span className="hint-text">{links?.length ?? 0}</span>
              </h2>
              <RequireRole minimum="editor">
                <div className="section-actions">
                  {outdatedPins > 0 && (
                    <>
                      <span className="hint-text">
                        {outdatedPins} pinned Platform{outdatedPins === 1 ? " has" : "s have"} a newer saved version.
                      </span>
                      <button
                        type="button"
                        className="button secondary small"
                        disabled={repinAll.isPending}
                        onClick={() => void repinAll.mutateAsync()}
                      >
                        {repinAll.isPending ? "Repinning…" : "Repin all to their latest version"}
                      </button>
                    </>
                  )}
                  <button type="button" className="button primary small" onClick={() => setPinningPlatform(true)}>
                    + Pin Platform
                  </button>
                </div>
              </RequireRole>
            </div>
            <MdfLinkTable
              mdfId={mdf.id}
              links={links ?? []}
              platformsById={platformsById}
              pinsFrozen={pinsFrozen}
              coverage={coverage}
            />
          </section>
          {pinningPlatform && (
            <Modal title="Pin a Platform" onClose={() => setPinningPlatform(false)}>
              <p className="hint-text">Pinning needs a saved version of the Platform (and of each Emitter it pins).</p>
              <PlatformVersionPicker mdfId={mdf.id} onDone={() => setPinningPlatform(false)} />
            </Modal>
          )}
        </div>
      )}

      {tab === "readiness" && <MdfReadinessPanel mdfId={mdf.id} onGo={(key) => setTab(READINESS_TAB[key] ?? "platforms")} />}
      {tab === "emitters" && <MdfEmittersTable mdfId={mdf.id} mdfName={mdf.name} />}
      {tab === "dwells" && <MdfDwellsPanel mdfId={mdf.id} pinsFrozen={pinsFrozen} canEdit={canWrite && !mdf.deleted_at} />}
      {tab === "plan" && <MdfPlanPanel mdf={mdf} versions={versions ?? []} canEdit={canWrite && !mdf.deleted_at} />}
      {tab === "charts" && <MdfCharts mdfId={mdf.id} />}
      {tab === "tests" && <MdfTestHistory mdfId={mdf.id} highlightTestRecordId={highlightTestRecordId} />}
      {tab === "files" && (
        <FilesPanel
          owner="mdf"
          ownerId={mdf.id}
          ownerName={mdf.name}
          canEdit={canWrite && !mdf.deleted_at}
          readOnlyReason={mdf.deleted_at ? "In the Trash — restore it to change its files." : undefined}
        />
      )}
      {tab === "audit" && <EntityAuditTrail entityType="mdf" entityId={mdf.id} />}
    </div>
  );
}
