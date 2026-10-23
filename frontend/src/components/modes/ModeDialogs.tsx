import type { EwGroup, Mode, Source } from "../../types/domain";
import { Modal } from "../common/Modal";
import { ModeEditForm } from "./ModeEditForm";
import { ModeForm } from "./ModeForm";

/** Editing a Mode from its ⋯ menu: the form in a dialog centred in the
 * window and never taller than it, so all of it — Save included — is in
 * view when it opens, wherever the Mode's row was. */
export function ModeEditDialog({
  emitterId,
  mode,
  sources,
  onClose,
}: {
  emitterId: string;
  mode: Mode;
  sources: Source[];
  onClose: () => void;
}) {
  return (
    <Modal title={`Edit ${mode.name}`} onClose={onClose} className="mode-dialog">
      <ModeEditForm emitterId={emitterId} mode={mode} sources={sources} onDone={onClose} />
    </Modal>
  );
}

/** A new Mode pre-filled from one, in the same kind of dialog. */
export function ModeDuplicateDialog({
  emitterId,
  mode,
  ewGroups,
  sources,
  onClose,
}: {
  emitterId: string;
  mode: Mode;
  ewGroups: EwGroup[];
  sources: Source[];
  onClose: () => void;
}) {
  return (
    <Modal title={`Copy of ${mode.name}`} onClose={onClose} className="mode-dialog">
      <ModeForm emitterId={emitterId} ewGroups={ewGroups} sources={sources} duplicateFrom={mode} onClose={onClose} />
    </Modal>
  );
}
