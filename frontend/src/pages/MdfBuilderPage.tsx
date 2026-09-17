import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useMdf, useMdfLinks, useUpdateMdf } from "../state/hooks/useMdfs";
import { useMdfVersions } from "../state/hooks/useMdfVersions";
import { usePlatforms } from "../state/hooks/usePlatforms";
import { useCustomers } from "../state/hooks/useCustomers";
import { MdfLinkTable } from "../components/mdf/MdfLinkTable";
import { PlatformVersionPicker } from "../components/mdf/PlatformVersionPicker";
import { MdfStatusTransitionControls } from "../components/mdf/MdfStatusTransitionControls";
import { ExportXmlButton } from "../components/mdf/ExportXmlButton";
import { ExportPrsButton } from "../components/versioning/ExportPrsButton";
import { MdfTestHistory } from "../components/testing/MdfTestHistory";
import { EntityAuditTrail } from "../components/audit/EntityAuditTrail";
import { RequireRole } from "../auth/RequireAuth";
import { LoadingState } from "../components/common/LoadingState";
import { Modal } from "../components/common/Modal";

type Tab = "platforms" | "tests" | "audit";

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
  const { data: customers } = useCustomers();
  const { mutate: updateMdf, isPending: isUpdating } = useUpdateMdf();

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
      <h1>{mdf.name}</h1>
      <div className="status-row">
        <span className={`status-badge status-${mdf.status}`}>{mdf.status.replace("_", " ")}</span>
        <MdfStatusTransitionControls mdfId={mdf.id} status={mdf.status} />
        <Link to={`/mdfs/${mdf.id}/versions`}>Version history</Link>
        <Link to={`/ambiguity/mdf/${mdf.id}`}>Ambiguity check</Link>
        <button className="button secondary small" onClick={handleStartEdit}>
          Edit Details
        </button>
        {latestVersion && <ExportXmlButton mdfId={mdf.id} versionNumber={latestVersion.version_number} />}
        {latestVersion && <ExportPrsButton kind="mdf" id={mdf.id} versionNumber={latestVersion.version_number} />}
      </div>
      {mdf.description && <p className="muted">{mdf.description}</p>}

      {isEditing && (
        <Modal title="Edit MDF Details" onClose={handleCancelEdit} wide>
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

      <div className="tab-bar">
        <button className={tab === "platforms" ? "tab active" : "tab"} onClick={() => setTab("platforms")}>
          Pinned Platforms
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
              Pinning requires a committed version of the platform (and each emitter it references).
            </p>
            <PlatformVersionPicker mdfId={mdf.id} />
          </RequireRole>
        </div>
      )}

      {tab === "tests" && <MdfTestHistory mdfId={mdf.id} highlightTestRecordId={highlightTestRecordId} />}
      {tab === "audit" && <EntityAuditTrail entityType="mdf" entityId={mdf.id} />}
    </div>
  );
}
