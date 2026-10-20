import { useQueries } from "@tanstack/react-query";
import { platformCoverageApi } from "../../api/platforms";
import type { DwellOverlay } from "./DwellChart";

/** The Platforms' pinned Emitters as dwell chart overlays: each Emitter's
 * Modes' RF ranges (as measured, without the matching margins), from the
 * Emitter version a Platform pins — every Emitter once, across all the
 * Platforms given. Shares the Platform charts' query. Undefined while
 * loading or with no Platform. */
export function usePlatformsEmitterOverlay(platformIds: string[]): DwellOverlay[] | undefined {
  const results = useQueries({
    queries: platformIds.map((id) => ({
      queryKey: ["platform-coverage", id],
      queryFn: () => platformCoverageApi.get(id),
    })),
  });
  if (platformIds.length === 0 || results.some((r) => !r.data)) return undefined;
  const seen = new Map<string, DwellOverlay>();
  for (const r of results)
    for (const e of r.data ?? [])
      if (!seen.has(e.emitter_id))
        seen.set(e.emitter_id, {
          id: e.emitter_id,
          label: e.designation ? `${e.designation} — ${e.emitter_name}` : e.emitter_name,
          spans: e.modes.map((m) => m.rf_raw ?? m.rf).filter((s): s is [number, number] => !!s),
          href: `/emitters/${e.emitter_id}`,
        });
  return [...seen.values()];
}

export function usePlatformEmitterOverlay(platformId: string | null | undefined): DwellOverlay[] | undefined {
  return usePlatformsEmitterOverlay(platformId ? [platformId] : []);
}

/** "North's Emitters", "North's and South's Emitters", "3 Platforms' Emitters". */
export function overlayTitle(platformNames: string[]): string {
  if (platformNames.length === 0) return "Emitters";
  if (platformNames.length === 1) return `${platformNames[0]}'s Emitters`;
  if (platformNames.length === 2) return `${platformNames[0]}'s and ${platformNames[1]}'s Emitters`;
  return `${platformNames.length} Platforms' Emitters`;
}
