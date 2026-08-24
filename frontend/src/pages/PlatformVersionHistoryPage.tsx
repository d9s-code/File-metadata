import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { usePlatform } from "../state/hooks/usePlatforms";
import {
  useCommitPlatformVersion,
  usePlatformVersionDiff,
  usePlatformVersions,
} from "../state/hooks/usePlatformVersions";
import { VersionList } from "../components/versioning/VersionList";
import { DiffViewer } from "../components/versioning/DiffViewer";
import { RequireRole } from "../auth/RequireAuth";
import { ApiRequestError } from "../api/client";

export function PlatformVersionHistoryPage() {
  const { platformId } = useParams<{ platformId: string }>();
  const { data: platform } = usePlatform(platformId);
  const { data: versions } = usePlatformVersions(platformId ?? "");
  const commitVersion = useCommitPlatformVersion(platformId ?? "");
  const [selected, setSelected] = useState<number | null>(null);
  const [changeSummary, setChangeSummary] = useState("");
  const [error, setError] = useState<string | null>(null);

  const { data: diff, isLoading: diffLoading } = usePlatformVersionDiff(platformId ?? "", selected ?? 0);

  async function handleCommit() {
    setError(null);
    try {
      await commitVersion.mutateAsync(changeSummary || undefined);
      setChangeSummary("");
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Failed to commit version");
    }
  }

  if (!platform) return <p>Loading…</p>;

  return (
    <div className="page">
      <h1>{platform.name} — Version History</h1>
      <Link to={`/platforms/${platform.id}`}>← Back to platform</Link>

      <RequireRole minimum="editor">
        <div className="card inline-form">
          <input
            placeholder="Change summary (optional)"
            value={changeSummary}
            onChange={(e) => setChangeSummary(e.target.value)}
          />
          <button onClick={() => void handleCommit()} disabled={commitVersion.isPending}>
            Commit Version
          </button>
        </div>
        {error && <div className="error-text">{error}</div>}
      </RequireRole>

      <div className="version-history-layout">
        <div className="card">
          <h4>Versions</h4>
          <VersionList versions={versions ?? []} selected={selected} onSelect={setSelected} />
        </div>
        <div className="card">
          <h4>{selected ? `Diff: v${selected - 1} → v${selected}` : "Select a version to view its diff"}</h4>
          {selected === 1 && <p className="hint-text">This is the first committed version — no prior version to diff against.</p>}
          {selected != null && selected > 1 && diffLoading && <p>Loading diff…</p>}
          {selected != null && selected > 1 && diff && <DiffViewer diff={diff} />}
        </div>
      </div>
    </div>
  );
}
