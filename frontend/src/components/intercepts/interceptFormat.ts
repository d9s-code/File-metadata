import type { Mode } from "../../types/domain";

/** A YYYY-MM-DD day, read as a local day rather than UTC midnight. */
export function formatDay(day: string | null) {
  return day ? new Date(`${day}T00:00:00`).toLocaleDateString() : null;
}

/** Where the Modes tab opens filtered to one Mode. */
export function modeLink(emitterId: string, mode: Pick<Mode, "name">) {
  return `/emitters/${emitterId}?tab=modes&mode=${encodeURIComponent(mode.name)}`;
}
