import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useEmitter } from "../state/hooks/useEmitters";
import {
  useEmitterVersionDiff,
  useEmitterVersions,
  useRevertEmitterVersion,
} from "../state/hooks/useEmitterVersions";
import { VersionList } from "../components/versioning/VersionList";
import { VersionPanel } from "../components/versioning/VersionPanel";
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
        { confirmLabel: "Revert", danger: true },
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
        {selected != null && (
          <VersionPanel
            versions={versions ?? []}
            selected={selected}
            against={against}
            onAgainst={setAgainst}
            diff={diff}
            loading={diffLoading}
            tags={isPreFork ? <span className="version-tag">Before fork</span> : undefined}
            notice={
              isForkPoint && against == null ? (
                <p className="hint-text">
                  This version is where the fork happened — every EW Group, Source and Mode got a fresh id here, so
                  this shows a full replacement rather than the (likely small) actual change.
                </p>
              ) : undefined
            }
            actions={
              <RequireRole minimum="editor">
                <button
                  className="button secondary small"
                  disabled={revertVersion.isPending || isPreFork || selected === latest}
                  title={
                    isPreFork
                      ? "This version predates the fork — fork from it again instead of reverting to it"
                      : selected === latest
                        ? "This is already the latest version"
                        : "Make the Emitter match this version again (saved as a new version)"
                  }
                  onClick={() => void handleRevert()}
                >
                  Revert to v{selected}…
                </button>
                <button className="button secondary small" onClick={() => setShowForkModal(true)} title="Start a new Emitter from this version">
                  Fork v{selected}…
                </button>
              </RequireRole>
            }
          />
        )}
      </div>
      {showForkModal && selected != null && (
        <ForkVersionModal emitterId={emitter.id} versionNumber={selected} onClose={() => setShowForkModal(false)} />
      )}
      {dialog}
    </div>
  );
}
