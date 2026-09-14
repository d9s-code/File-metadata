import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useEmitter } from "../state/hooks/useEmitters";
import {
  useCommitEmitterVersion,
  useEmitterVersionDiff,
  useEmitterVersions,
  useRevertEmitterVersion,
} from "../state/hooks/useEmitterVersions";
import { VersionList } from "../components/versioning/VersionList";
import { EmitterDiffViewer } from "../components/versioning/EmitterDiffViewer";
import { ForkVersionModal } from "../components/versioning/ForkVersionModal";
import { RequireRole } from "../auth/RequireAuth";
import { ApiRequestError } from "../api/client";
import { LoadingState } from "../components/common/LoadingState";
import { useConfirmDialog } from "../components/common/ConfirmDialog";

export function EmitterVersionHistoryPage() {
  const { emitterId } = useParams<{ emitterId: string }>();
  const { data: emitter } = useEmitter(emitterId);
  const { data: versions } = useEmitterVersions(emitterId ?? "");
  const commitVersion = useCommitEmitterVersion(emitterId ?? "");
  const revertVersion = useRevertEmitterVersion(emitterId ?? "");
  const [searchParams] = useSearchParams();
  const initialVersion = Number(searchParams.get("version"));
  const [selected, setSelected] = useState<number | null>(initialVersion > 0 ? initialVersion : null);
  const [changeSummary, setChangeSummary] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [showForkModal, setShowForkModal] = useState(false);
  const { confirmDelete, dialog } = useConfirmDialog();

  const { data: diff, isLoading: diffLoading } = useEmitterVersionDiff(emitterId ?? "", selected ?? 0);

  async function handleCommit() {
    setError(null);
    if (!changeSummary.trim()) {
      setError("A change summary is required.");
      return;
    }
    try {
      await commitVersion.mutateAsync(changeSummary);
      setChangeSummary("");
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Failed to commit version");
    }
  }

  async function handleRevert() {
    if (selected == null) return;
    setError(null);
    if (
      !(await confirmDelete(
        `Revert live Emitter data to version ${selected}? This overwrites current EW Groups/Sources/Modes and commits a new version documenting the revert.`,
      ))
    ) {
      return;
    }
    try {
      await revertVersion.mutateAsync(selected);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Failed to revert to this version");
    }
  }

  if (!emitter) return <LoadingState label="Loading version history…" />;

  return (
    <div className="page">
      <h1>{emitter.name} — Version History</h1>
      <Link to={`/emitters/${emitter.id}`}>← Back to editor</Link>

      <RequireRole minimum="editor">
        <div className="card inline-form">
          <input
            placeholder="Change summary (required)"
            value={changeSummary}
            onChange={(e) => setChangeSummary(e.target.value)}
          />
          <button onClick={() => void handleCommit()} disabled={commitVersion.isPending || !changeSummary.trim()}>
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
          {selected != null && selected > 1 && diff && <EmitterDiffViewer diff={diff} />}
          {selected != null && (
            <RequireRole minimum="editor">
              <div className="form-row">
                <button className="link-button" disabled={revertVersion.isPending} onClick={() => void handleRevert()}>
                  Revert to this version
                </button>
                <button className="link-button" onClick={() => setShowForkModal(true)}>
                  Fork this version
                </button>
              </div>
            </RequireRole>
          )}
        </div>
      </div>
      {showForkModal && selected != null && (
        <ForkVersionModal emitterId={emitter.id} versionNumber={selected} onClose={() => setShowForkModal(false)} />
      )}
      {dialog}
    </div>
  );
}
