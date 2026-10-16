/** A stagger's firing order as typed: "1" or "1, 3" (an Element that fires
 * twice). Null unless every position is a whole number from 1. */
export function parsePositions(raw: string): number[] | null {
  const parts = raw.split(/[\s,;]+/).filter(Boolean);
  if (parts.length === 0) return null;
  const nums = parts.map(Number);
  return nums.every((n) => Number.isInteger(n) && n >= 1) ? nums : null;
}
