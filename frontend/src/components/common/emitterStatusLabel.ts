import type { EmitterStatus } from "../../types/domain";

/** Display labels for EmitterStatus — the stored values (draft/in_review/
 * validated/deprecated) stay as-is everywhere else (DB, API, CSS status-*
 * classes); only what's shown to a person changed. */
export const EMITTER_STATUS_LABEL: Record<EmitterStatus, string> = {
  draft: "In progress",
  in_review: "Testing",
  validated: "Operational",
  deprecated: "Needs rework",
};

export function emitterStatusLabel(status: EmitterStatus): string {
  return EMITTER_STATUS_LABEL[status];
}
