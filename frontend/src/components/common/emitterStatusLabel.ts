/** The built-in Emitter statuses' default names — for where the statuses
 * Admins set up aren't at hand (e.g. formatting audit changes). Pages use
 * StatusBadge / useStatuses, which follow renames. */
export const EMITTER_STATUS_LABEL: Record<string, string> = {
  draft: "In progress",
  in_review: "Testing",
  partially_operational: "Partially operational",
  validated: "Operational",
  deprecated: "Needs rework",
};

/** Any other status as shown to a person: "pending_review" → "Pending review". */
export function statusLabel(status: string): string {
  const words = status.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}
