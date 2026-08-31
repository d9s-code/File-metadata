import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useMdf, useMdfLinks } from "../state/hooks/useMdfs";
import { useMdfVersions } from "../state/hooks/useMdfVersions";
import { usePlatforms } from "../state/hooks/usePlatforms";
import { MdfLinkTable } from "../components/mdf/MdfLinkTable";
import { PlatformVersionPicker } from "../components/mdf/PlatformVersionPicker";
import { MdfStatusTransitionControls } from "../components/mdf/MdfStatusTransitionControls";
import { ExportXmlButton } from "../components/mdf/ExportXmlButton";
import { MdfTestHistory } from "../components/testing/MdfTestHistory";
import { EntityAuditTrail } from "../components/audit/EntityAuditTrail";
import { RequireRole } from "../auth/RequireAuth";
import { LoadingState } from "../components/common/LoadingState";

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

  if (isLoading || !mdf) return <LoadingState label="Loading MDF…" />;

  const platformsById = Object.fromEntries((platforms ?? []).map((p) => [p.id, p]));
  const latestVersion = versions && versions.length > 0 ? versions[versions.length - 1] : null;

  return (
    <div className="page">
      <h1>{mdf.name}</h1>
      <div className="status-row">
        <span className={`status-badge status-${mdf.status}`}>{mdf.status.replace("_", " ")}</span>
        <MdfStatusTransitionControls mdfId={mdf.id} status={mdf.status} />
        <Link to={`/mdfs/${mdf.id}/versions`}>Version history</Link>
        <Link to={`/ambiguity/mdf/${mdf.id}`}>Ambiguity check</Link>
        {latestVersion && <ExportXmlButton mdfId={mdf.id} versionNumber={latestVersion.version_number} />}
      </div>
      {mdf.description && <p className="muted">{mdf.description}</p>}

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
