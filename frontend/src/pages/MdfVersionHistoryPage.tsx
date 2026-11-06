import { useEffect, useState } from "react";
import { BackLink } from "../components/common/BackLink";
import { Link, useParams } from "react-router-dom";
import { useMdf } from "../state/hooks/useMdfs";
import { useCommitMdfVersion, useMdfVersionDiff, useMdfVersions } from "../state/hooks/useMdfVersions";
import { VersionList } from "../components/versioning/VersionList";
import { VersionPanel } from "../components/versioning/VersionPanel";
import { ExportPrsButton } from "../components/versioning/ExportPrsButton";
import { useMdfReportDownload } from "../components/mdf/mdfReport";
import { SaveVersionButton } from "../components/versioning/SaveVersionButton";
import { LoadingState } from "../components/common/LoadingState";

export function MdfVersionHistoryPage() {
  const { mdfId } = useParams<{ mdfId: string }>();
  const { data: mdf } = useMdf(mdfId);
  const { data: versions } = useMdfVersions(mdfId ?? "");
  const commitVersion = useCommitMdfVersion(mdfId ?? "");
  const [selected, setSelected] = useState<number | null>(null);
  const report = useMdfReportDownload();

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
      <BackLink to={`/mdfs/${mdf.id}`}>{mdf.name}</BackLink>
      <div className="emitter-title-row">
        <h1>{mdf.name} — Version History</h1>
        <div className="emitter-actions">
          <Link className="link-as-button" to={`/mdfs/compare?a=${mdf.id}&b=${mdf.id}`}>
            Compare versions
          </Link>
          <SaveVersionButton
            noun="MDF"
            save={(summary) => commitVersion.mutateAsync(summary)}
            pending={commitVersion.isPending}
          />
        </div>
      </div>

      <div className="version-history-layout">
        <div className="card">
          <h2 className="as-h4">Versions</h2>
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
                <ExportPrsButton kind="mdf" id={mdf.id} versionNumber={selected} />
                <button
                  className="button secondary small"
                  onClick={() => void report.download(mdf, selected)}
                  disabled={report.downloading}
                  title="This version's report (.xlsx), laid out like the other app's import report"
                >
                  {report.downloading ? "Making the report…" : `Report v${selected} (.xlsx)`}
                </button>
                {report.error && <span className="error-text"> {report.error}</span>}
              </>
            }
          />
        )}
      </div>
    </div>
  );
}
