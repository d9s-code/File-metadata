import { useState } from "react";
import type { EmitterSave } from "../../api/emitterVersions";
import { ApiRequestError } from "../../api/client";
import { RequireRole } from "../../auth/RequireAuth";
import { useEmitterHistoryDiff, usePromoteCheckpoint, useRestoreCheckpoint } from "../../state/hooks/useEmitterVersions";
import { useConfirmDialog } from "../common/ConfirmDialog";
import { Modal } from "../common/Modal";
import { EmitterDiffViewer, changeCounts } from "./EmitterDiffViewer";
import { versionDate } from "./VersionList";

/** A selected checkpoint: its note, what changed since an earlier save, going
 * back to it while editing, and making it the next version. */
export function CheckpointPanel({
  emitterId,
  checkpoint,
  history,
  editing,
}: {
  emitterId: string;
  checkpoint: EmitterSave;
  /** Every save, oldest first. */
  history: EmitterSave[];
  /** Whether the viewer holds the edit lock. */
  editing: boolean;
}) {
  const index = history.findIndex((s) => s.ref === checkpoint.ref);
  const earlier = history.slice(0, index).reverse();
  const [against, setAgainst] = useState<string | null>(null);
  const baseline = against ?? earlier[0]?.ref ?? null;
  const { data: diff, isLoading } = useEmitterHistoryDiff(emitterId, baseline, checkpoint.ref);
  const restore = useRestoreCheckpoint(emitterId);
  const promote = usePromoteCheckpoint(emitterId);
  const { confirmDelete, dialog } = useConfirmDialog();
  const [error, setError] = useState<string | null>(null);
  const [promoting, setPromoting] = useState(false);
  const [summary, setSummary] = useState("");

  const versions = history.filter((s) => s.kind === "version");
  const lastVersion = versions[versions.length - 1];
  const base = Number(checkpoint.ref.split(".")[0]);
  const next = (lastVersion ? Number(lastVersion.ref) : 0) + 1;
  // Only a checkpoint since the latest version can become the next one.
  const promotable = base === (lastVersion ? Number(lastVersion.ref) : 0) && checkpoint.promoted_to_version_number == null;

  async function goBack() {
    if (
      !(await confirmDelete(
        `Make the Emitter as it was at v${checkpoint.ref}? Your unsaved changes go — save a checkpoint first to keep them. It stays unsaved until you save.`,
        { confirmLabel: `Go back to v${checkpoint.ref}`, danger: true },
      ))
    )
      return;
    setError(null);
    try {
      await restore.mutateAsync(checkpoint.ref);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Couldn't go back to it");
    }
  }

  async function makeVersion() {
    setError(null);
    try {
      await promote.mutateAsync({ ref: checkpoint.ref, changeSummary: summary.trim() });
      setPromoting(false);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Couldn't make it a version");
    }
  }

  return (
    <div className="card version-panel">
      <div className="version-panel-head">
        <div>
          <h2 className="version-panel-title">
            Checkpoint {checkpoint.ref}
            <span className="version-tag checkpoint">Checkpoint</span>
            {checkpoint.promoted_to_version_number != null && (
              <span className="version-tag">Made into v{checkpoint.promoted_to_version_number}</span>
            )}
          </h2>
          <p className={checkpoint.change_summary ? "version-panel-summary" : "version-panel-summary none"}>
            {checkpoint.change_summary || "No note"}
          </p>
          <p className="hint-text version-panel-meta">
            Saved {checkpoint.created_by_username ? `by ${checkpoint.created_by_username} ` : ""}on{" "}
            {versionDate(checkpoint.created_at)} — a save made while editing, not a version: nothing pins, exports or
            tests it.
          </p>
        </div>
        <RequireRole minimum="editor">
          <div className="version-panel-actions">
            <button
              className="button secondary small"
              disabled={!editing || restore.isPending}
              title={editing ? "Make the Emitter as it was here again — unsaved, until you save" : "Start editing first"}
              onClick={() => void goBack()}
            >
              Go back to it…
            </button>
            <button
              className="button secondary small"
              disabled={!promotable || promote.isPending}
              title={
                checkpoint.promoted_to_version_number != null
                  ? `Already made into v${checkpoint.promoted_to_version_number}`
                  : promotable
                    ? `Save it as v${next} — the version Platforms can pin and tests count against`
                    : `Only a checkpoint since v${lastVersion?.ref} can become the next version`
              }
              onClick={() => {
                setSummary(checkpoint.change_summary ?? "");
                setPromoting(true);
              }}
            >
              Make it v{next}…
            </button>
          </div>
        </RequireRole>
      </div>
      {error && <div className="error-text">{error}</div>}

      <div className="version-compare">
        {baseline == null ? (
          <span className="hint-text">The first save — there&apos;s nothing before it to compare with.</span>
        ) : (
          <>
            <label className="inline-label">
              Changes since
              <select value={against ?? ""} onChange={(e) => setAgainst(e.target.value || null)}>
                {earlier.map((s, i) => (
                  <option key={s.ref} value={i === 0 ? "" : s.ref}>
                    v{s.ref}
                    {i === 0 ? " (the save before)" : s.kind === "version" ? " (version)" : ""}
                  </option>
                ))}
              </select>
            </label>
            {diff && !diff.identical && <span className="hint-text">{changeCounts(diff.entries)}</span>}
          </>
        )}
      </div>
      {baseline != null && isLoading && <p className="hint-text">Loading changes…</p>}
      {baseline != null && diff && <EmitterDiffViewer diff={diff} />}
      {dialog}
      {promoting && (
        <Modal title={`Make v${checkpoint.ref} into v${next}`} onClose={() => setPromoting(false)}>
          <p className="hint-text">
            Saves the checkpoint as v{next}, exactly as it was then — the version Platforms can pin, exports use and
            tests count against. The Emitter as it is now isn&apos;t changed.
          </p>
          <label>
            What&apos;s in it? (required)
            <textarea className="edit-input" rows={3} value={summary} onChange={(e) => setSummary(e.target.value)} autoFocus />
          </label>
          {error && <div className="error-text">{error}</div>}
          <div className="modal-actions">
            <button className="button secondary" onClick={() => setPromoting(false)} disabled={promote.isPending}>
              Cancel
            </button>
            <button className="button primary" onClick={() => void makeVersion()} disabled={promote.isPending || !summary.trim()}>
              {promote.isPending ? "Saving…" : `Save as v${next}`}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
