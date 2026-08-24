import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useEmitter } from "../state/hooks/useEmitters";
import {
  useCommitEmitterVersion,
  useEmitterVersionDiff,
  useEmitterVersions,
} from "../state/hooks/useEmitterVersions";
import { VersionList } from "../components/versioning/VersionList";
import { DiffViewer } from "../components/versioning/DiffViewer";
import { RequireRole } from "../auth/RequireAuth";
import { ApiRequestError } from "../api/client";

export function EmitterVersionHistoryPage() {
  const { emitterId } = useParams<{ emitterId: string }>();
  const { data: emitter } = useEmitter(emitterId);
  const { data: versions } = useEmitterVersions(emitterId ?? "");
  const commitVersion = useCommitEmitterVersion(emitterId ?? "");
  const [selected, setSelected] = useState<number | null>(null);
  const [changeSummary, setChangeSummary] = useState("");
  const [error, setError] = useState<string | null>(null);

  const { data: diff, isLoading: diffLoading } = useEmitterVersionDiff(emitterId ?? "", selected ?? 0);

  async function handleCommit() {
    setError(null);
    try {
      await commitVersion.mutateAsync(changeSummary || undefined);
      setChangeSummary("");
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Failed to commit version");
    }
  }

  if (!emitter) return <p>Loading…</p>;

  return (
    <div className="page">
      <h1>{emitter.name} — Version History</h1>
      <Link to={`/emitters/${emitter.id}`}>← Back to editor</Link>

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
          <h4>{selected ? `Diff: v${selected - 1 < 1 ? "(none)" : selected - 1} → v${selected}` : "Select a version to view its diff"}</h4>
          {selected && diffLoading && <p>Loading diff…</p>}
          {selected && diff && <DiffViewer diff={diff} />}
        </div>
      </div>
    </div>
  );
}
