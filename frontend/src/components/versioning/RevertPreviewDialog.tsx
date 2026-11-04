import { useQuery } from "@tanstack/react-query";
import { Modal } from "../common/Modal";
import { emitterVersionsApi } from "../../api/emitterVersions";
import { EmitterDiffViewer } from "./EmitterDiffViewer";

/** Before a revert: what it changes in the live Emitter, item by item, the
 * logged results naming what it removes (kept, shown as deleted), and the
 * unsaved changes it throws away. */
export function RevertPreviewDialog({
  emitterId,
  versionNumber,
  pending,
  onRevert,
  onClose,
}: {
  emitterId: string;
  versionNumber: number;
  pending: boolean;
  onRevert: () => void;
  onClose: () => void;
}) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["revertPreview", emitterId, versionNumber],
    queryFn: () => emitterVersionsApi.revertPreview(emitterId, versionNumber),
    staleTime: 0,
  });
  const count = (kind: string) => data?.entries.filter((e) => e.kind === kind).length ?? 0;
  return (
    <Modal title={`Revert to v${versionNumber}?`} onClose={onClose} wide>
      <div className="revert-preview">
        {isLoading ? (
          <p className="hint-text">Working out what it changes…</p>
        ) : error || !data ? (
          <p className="error-text">{(error as Error | null)?.message ?? "Couldn't work out what it changes."}</p>
        ) : (
          <>
            <p>
              The Emitter is set back to v{versionNumber} and saved as a new version — history isn&apos;t rewritten.{" "}
              {data.identical ? (
                "It's the same as v" + versionNumber + " already: nothing changes."
              ) : (
                <strong>
                  {count("removed")} removed · {count("added")} brought back · {count("changed")} changed
                </strong>
              )}
            </p>
            {data.unsaved_changes > 0 && (
              <p className="error-text">
                ⚠ {data.unsaved_changes} unsaved change{data.unsaved_changes === 1 ? "" : "s"} since the last saved version{" "}
                {data.unsaved_changes === 1 ? "is" : "are"} thrown away.
              </p>
            )}
            {data.results_naming_removed > 0 && (
              <p className="hint-text">
                {data.results_naming_removed} logged test result{data.results_naming_removed === 1 ? " names" : "s name"} a
                Mode or SIM line this removes. They&apos;re kept, show it as <em>(deleted)</em>, and link up again if a
                revert brings it back.
              </p>
            )}
            {!data.identical && (
              <div className="revert-preview-list">
                <EmitterDiffViewer diff={data} />
              </div>
            )}
          </>
        )}
        <div className="modal-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="button danger-outline" disabled={pending || isLoading || !data} onClick={onRevert}>
            {pending ? "Reverting…" : `Revert to v${versionNumber}`}
          </button>
        </div>
      </div>
    </Modal>
  );
}
