import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMdf } from "../state/hooks/useMdfs";
import { useCommitMdfVersion, useMdfVersionDiff, useMdfVersions } from "../state/hooks/useMdfVersions";
import { VersionList } from "../components/versioning/VersionList";
import { DiffViewer } from "../components/versioning/DiffViewer";
import { ExportXmlButton } from "../components/mdf/ExportXmlButton";
import { ExportPrsButton } from "../components/versioning/ExportPrsButton";
import { SaveVersionButton } from "../components/versioning/SaveVersionButton";
import { LoadingState } from "../components/common/LoadingState";

export function MdfVersionHistoryPage() {
  const { mdfId } = useParams<{ mdfId: string }>();
  const { data: mdf } = useMdf(mdfId);
  const { data: versions } = useMdfVersions(mdfId ?? "");
  const commitVersion = useCommitMdfVersion(mdfId ?? "");
  const [selected, setSelected] = useState<number | null>(null);

  const { data: diff, isLoading: diffLoading } = useMdfVersionDiff(mdfId ?? "", selected ?? 0);

  if (!mdf) return <LoadingState label="Loading version history…" />;

  return (
    <div className="page">
      <Link to={`/mdfs/${mdf.id}`}>← Back to {mdf.name}</Link>
      <div className="emitter-title-row">
        <h1>{mdf.name} — Version History</h1>
        <div className="emitter-actions">
          <SaveVersionButton
            noun="MDF"
            save={(summary) => commitVersion.mutateAsync(summary)}
            pending={commitVersion.isPending}
          />
        </div>
      </div>

      <div className="version-history-layout">
        <div className="card">
          <h4>Versions</h4>
          <VersionList versions={versions ?? []} selected={selected} onSelect={setSelected} />
        </div>
        <div className="card">
          <div className="version-diff-header">
            <h4>{selected ? `Diff: v${selected - 1} → v${selected}` : "Select a version to view its diff"}</h4>
            {selected != null && <ExportXmlButton mdfId={mdf.id} versionNumber={selected} />}
            {selected != null && <ExportPrsButton kind="mdf" id={mdf.id} versionNumber={selected} />}
          </div>
          {selected === 1 && <p className="hint-text">This is the first saved version — no prior version to diff against.</p>}
          {selected != null && selected > 1 && diffLoading && <p>Loading diff…</p>}
          {selected != null && selected > 1 && diff && <DiffViewer diff={diff} />}
        </div>
      </div>
    </div>
  );
}
