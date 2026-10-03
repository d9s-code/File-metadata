import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { usePlatform } from "../state/hooks/usePlatforms";
import {
  useCommitPlatformVersion,
  usePlatformVersionDiff,
  usePlatformVersions,
} from "../state/hooks/usePlatformVersions";
import { VersionList } from "../components/versioning/VersionList";
import { VersionPanel } from "../components/versioning/VersionPanel";
import { ExportPrsButton } from "../components/versioning/ExportPrsButton";
import { SaveVersionButton } from "../components/versioning/SaveVersionButton";
import { LoadingState } from "../components/common/LoadingState";

export function PlatformVersionHistoryPage() {
  const { platformId } = useParams<{ platformId: string }>();
  const { data: platform } = usePlatform(platformId);
  const { data: versions } = usePlatformVersions(platformId ?? "");
  const commitVersion = useCommitPlatformVersion(platformId ?? "");
  const [searchParams] = useSearchParams();
  const initialVersion = Number(searchParams.get("version"));
  const [selected, setSelected] = useState<number | null>(initialVersion > 0 ? initialVersion : null);

  /** The version compared with; null = the one just before. */
  const [against, setAgainst] = useState<number | null>(null);
  const { data: diff, isLoading: diffLoading } = usePlatformVersionDiff(platformId ?? "", selected ?? 0, against ?? undefined);

  // Open on the newest version rather than an empty panel.
  const latest = versions?.length ? Math.max(...versions.map((v) => v.version_number)) : null;
  useEffect(() => {
    if (selected == null && latest != null) setSelected(latest);
  }, [selected, latest]);

  if (!platform) return <LoadingState label="Loading version history…" />;

  return (
    <div className="page">
      <Link to={`/platforms/${platform.id}`}>← Back to {platform.name}</Link>
      <div className="emitter-title-row">
        <h1>{platform.name} — Version History</h1>
        <div className="emitter-actions">
          <SaveVersionButton
            noun="Platform"
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
              <ExportPrsButton kind="platform" id={platform.id} versionNumber={selected} />
            }
          />
        )}
      </div>
    </div>
  );
}
