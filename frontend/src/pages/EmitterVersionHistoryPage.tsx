import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useEmitter } from "../state/hooks/useEmitters";
import {
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
import { EditModeControls } from "../components/versioning/EditModeControls";

export function EmitterVersionHistoryPage() {
  const { emitterId } = useParams<{ emitterId: string }>();
  const { data: emitter } = useEmitter(emitterId);
  const { data: forkSource } = useEmitter(emitter?.forked_from_emitter_id ?? undefined);
  const { data: versions } = useEmitterVersions(emitterId ?? "");
  const revertVersion = useRevertEmitterVersion(emitterId ?? "");
  const [searchParams] = useSearchParams();
  const initialVersion = Number(searchParams.get("version"));
  const [selected, setSelected] = useState<number | null>(initialVersion > 0 ? initialVersion : null);
  /** Version to diff the selected one against; null = the one just before it. */
  const [against, setAgainst] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showForkModal, setShowForkModal] = useState(false);
  const { confirmDelete, dialog } = useConfirmDialog();

  // Open on the newest version rather than an empty "select a version" panel.
  const latest = versions?.length ? Math.max(...versions.map((v) => v.version_number)) : null;
  useEffect(() => {
    if (selected == null && latest != null) setSelected(latest);
  }, [selected, latest]);

  function select(versionNumber: number) {
    setSelected(versionNumber);
    setAgainst(null);
  }

  // Any other version to diff against, besides the default (the one just before).
  const compareOptions =
    selected == null
      ? []
      : [...(versions ?? [])].reverse().filter((v) => v.version_number !== selected && v.version_number !== selected - 1);
  const baseline = against ?? (selected != null && selected > 1 ? selected - 1 : null);
  const { data: diff, isLoading: diffLoading } = useEmitterVersionDiff(emitterId ?? "", selected ?? 0, against ?? undefined);

  const forkBoundary = emitter?.forked_at_version_number ?? null;
  const isPreFork = forkBoundary != null && selected != null && selected <= forkBoundary;
  const isForkPoint = forkBoundary != null && selected === forkBoundary + 1;

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
      <Link to={`/emitters/${emitter.id}`}>← Back to {emitter.name}</Link>
      <div className="emitter-title-row">
        <h1>{emitter.name} — Version History</h1>
        <div className="emitter-actions">
          <EditModeControls emitter={emitter} />
        </div>
      </div>
      {emitter.forked_from_emitter_id && (
        <p className="hint-text">
          Forked from{" "}
          <Link to={`/emitters/${emitter.forked_from_emitter_id}/versions`}>
            {forkSource?.name ?? "an earlier Emitter"}
          </Link>
          {forkBoundary != null &&
            (forkBoundary === 1
              ? " — version 1 is that Emitter's history, before the fork"
              : ` — versions 1–${forkBoundary} are that Emitter's history, before the fork`)}
          .
        </p>
      )}

      {error && <div className="error-text">{error}</div>}

      <div className="version-history-layout">
        <div className="card">
          <h4>Versions</h4>
          <VersionList versions={versions ?? []} selected={selected} onSelect={select} forkBoundary={forkBoundary} />
        </div>
        <div className="card">
          <div className="card-header">
            <h4>
              {selected == null
                ? "Select a version to view its changes"
                : baseline == null
                  ? `v${selected}`
                  : `Changes: v${baseline} → v${selected}`}
            </h4>
            {compareOptions.length > 0 && (
              <label className="inline-label">
                Compare with{" "}
                <select
                  value={against ?? ""}
                  onChange={(e) => setAgainst(e.target.value === "" ? null : Number(e.target.value))}
                >
                  <option value="">{selected != null && selected > 1 ? `previous (v${selected - 1})` : "—"}</option>
                  {compareOptions.map((v) => (
                    <option key={v.id} value={v.version_number}>
                      v{v.version_number}
                      {v.version_number === latest ? " (latest)" : ""}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          {selected === 1 && against == null && <p className="hint-text">This is the first committed version — no prior version to diff against.</p>}
          {isForkPoint && against == null && (
            <p className="hint-text">
              This version is where the fork happened — every EW Group/Source/Mode got a fresh id here, so this
              diff shows a full replacement rather than the (likely small) actual change.
            </p>
          )}
          {baseline != null && diffLoading && <p>Loading changes…</p>}
          {baseline != null && diff && <EmitterDiffViewer diff={diff} />}
          {selected != null && (
            <RequireRole minimum="editor">
              <div className="form-row">
                <button
                  className="link-button"
                  disabled={revertVersion.isPending || isPreFork}
                  title={isPreFork ? "This version predates the fork — fork from it again instead of reverting to it" : undefined}
                  onClick={() => void handleRevert()}
                >
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
