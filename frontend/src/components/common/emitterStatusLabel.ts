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

/** Any other status as shown to a person: "pending_review" → "Pending review"
 * — so MDFs, Sources and the rest read the same way as Emitters. */
export function statusLabel(status: string): string {
  const words = status.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}
