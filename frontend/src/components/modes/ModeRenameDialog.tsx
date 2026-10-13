import type { Mode } from "../../types/domain";
import { useEmitterModes, useUpdateMode } from "../../state/hooks/useModes";
import { RenameDialog } from "../common/RenameDialog";

/** Renaming a Mode from its ⋯ menu; its name has to differ from the other
 * Modes in its EW Group. */
export function ModeRenameDialog({ emitterId, mode, onClose }: { emitterId: string; mode: Mode; onClose: () => void }) {
  const { data: emitterModes } = useEmitterModes(emitterId);
  const updateMode = useUpdateMode(emitterId);
  return (
    <RenameDialog
      what="Mode"
      currentName={mode.name}
      takenNames={(emitterModes ?? []).filter((m) => m.id !== mode.id && m.ew_group_id === mode.ew_group_id).map((m) => m.name)}
      takenWhere="in this EW Group"
      onRename={(name) => updateMode.mutateAsync({ ewGroupId: mode.ew_group_id, modeId: mode.id, input: { name } })}
      onClose={onClose}
    />
  );
}
