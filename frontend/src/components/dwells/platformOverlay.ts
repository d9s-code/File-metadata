import { useQuery } from "@tanstack/react-query";
import { platformCoverageApi } from "../../api/platforms";
import type { DwellOverlay } from "./DwellChart";

/** The Platform's pinned Emitters as dwell chart overlays: each Emitter's
 * Modes' RF ranges (as measured, without the matching margins), from the
 * Emitter version the Platform pins. Shares the Platform charts' query. */
export function usePlatformEmitterOverlay(platformId: string | null | undefined): DwellOverlay[] | undefined {
  const { data } = useQuery({
    queryKey: ["platform-coverage", platformId],
    queryFn: () => platformCoverageApi.get(platformId as string),
    enabled: !!platformId,
  });
  return data?.map((e) => ({
    id: e.emitter_id,
    label: e.designation ? `${e.designation} — ${e.emitter_name}` : e.emitter_name,
    spans: e.modes.map((m) => m.rf_raw ?? m.rf).filter((s): s is [number, number] => !!s),
    href: `/emitters/${e.emitter_id}`,
  }));
}
