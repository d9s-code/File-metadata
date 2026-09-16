import type { ModeElement } from "../../types/domain";

/** A group of one or more Elements sharing the same value_min/value_max —
 * nothing else is compared (jitter and delta are deliberately ignored, and
 * may genuinely differ between members). Stagger-shaped Elements (no
 * value_min/value_max) are never grouped with anything — each gets its own
 * single-member group, unmerged. */
export interface MergedElementGroup {
  /** Stable key for this group; also the id submitted to the backend when
   * the group is used as a Cartesian Product selection (its members are
   * numerically interchangeable on value_min/value_max, so any one of them
   * is a valid representative). */
  representativeId: string;
  memberIds: string[];
  members: ModeElement[];
  value_min: number | null;
  value_max: number | null;
  stagger_values: number[] | null;
}

export function groupElements(elements: ModeElement[]): MergedElementGroup[] {
  const rangeGroups = new Map<string, ModeElement[]>();
  const staggerGroups: MergedElementGroup[] = [];

  for (const el of elements) {
    if (el.stagger_values) {
      staggerGroups.push({
        representativeId: el.id,
        memberIds: [el.id],
        members: [el],
        value_min: null,
        value_max: null,
        stagger_values: el.stagger_values,
      });
      continue;
    }
    const key = `${el.value_min}:${el.value_max}`;
    const list = rangeGroups.get(key);
    if (list) list.push(el);
    else rangeGroups.set(key, [el]);
  }

  const merged: MergedElementGroup[] = [...rangeGroups.values()].map((members) => ({
    representativeId: members[0].id,
    memberIds: members.map((m) => m.id),
    members,
    value_min: members[0].value_min,
    value_max: members[0].value_max,
    stagger_values: null,
  }));

  return [...merged, ...staggerGroups];
}
