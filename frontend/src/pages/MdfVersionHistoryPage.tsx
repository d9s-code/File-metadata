import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMdf } from "../state/hooks/useMdfs";
import { useCommitMdfVersion, useMdfVersionDiff, useMdfVersions } from "../state/hooks/useMdfVersions";
import { VersionList } from "../components/versioning/VersionList";
import { VersionPanel } from "../components/versioning/VersionPanel";
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

  /** The version compared with; null = the one just before. */
  const [against, setAgainst] = useState<number | null>(null);
  const { data: diff, isLoading: diffLoading } = useMdfVersionDiff(mdfId ?? "", selected ?? 0, against ?? undefined);

  // Open on the newest version rather than an empty panel.
  const latest = versions?.length ? Math.max(...versions.map((v) => v.version_number)) : null;
  useEffect(() => {
    if (selected == null && latest != null) setSelected(latest);
  }, [selected, latest]);

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
          <VersionList
            versions={versions ?? []}
            selected={selected}
            onSelect={(n) => {
              setSelected(n);
              setAgainst(null);
            }}
          />
        </div>
        {selected != null && (
          <VersionPanel
            versions={versions ?? []}
            selected={selected}
            against={against}
            onAgainst={setAgainst}
            diff={diff && { entries: diff.entries ?? [], identical: diff.identical }}
            loading={diffLoading}
            actions={
              <>
                  <ExportXmlButton mdfId={mdf.id} versionNumber={selected} />
                  <ExportPrsButton kind="mdf" id={mdf.id} versionNumber={selected} />
                </>
            }
          />
        )}
      </div>
    </div>
  );
}
