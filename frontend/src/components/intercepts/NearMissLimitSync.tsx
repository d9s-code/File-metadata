import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../../auth/AuthContext";
import { dwellsApi } from "../../api/dwells";
import { settingsKey } from "../../state/hooks/useDwells";
import { setNearMissPct } from "./interceptMatch";

/** Keeps matching's near-miss limit at the admin's setting, so every page
 * that lists near misses uses it without passing it along. Renders nothing. */
export function NearMissLimitSync() {
  const { user } = useAuth();
  const { data } = useQuery({ queryKey: settingsKey, queryFn: dwellsApi.settings, enabled: !!user });
  const pct = data?.mode_defaults?.near_miss_pct;
  if (pct != null) setNearMissPct(pct);
  return null;
}
