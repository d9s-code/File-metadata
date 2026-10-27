import { useState } from "react";
import { Link } from "react-router-dom";
import { RequireRole } from "../../auth/RequireAuth";
import { formatDate } from "../common/dates";
import { useAppSettings, useDwellStrategies, useDwellStrategy } from "../../state/hooks/useDwells";
import { NewStrategy } from "../../pages/DwellsListPage";
import { DwellChart, num } from "./DwellChart";
import { usePlatformEmitterOverlay } from "./platformOverlay";

/** A Platform's Dwell Strategies, on its page: the list, and the picked one's
 * chart with the frequencies the Platform's pinned Emitters occupy behind
 * it — so gaps in the dwells stand out. */
export function PlatformDwells({ platformId, platformName }: { platformId: string; platformName: string }) {
  const { data: strategies, isLoading } = useDwellStrategies(platformId);
  const [picked, setPicked] = useState<string | null>(null);
  const [making, setMaking] = useState(false);
  const selectedId = picked ?? strategies?.[0]?.id ?? "";
  const { data: strategy } = useDwellStrategy(selectedId);
  const { data: settings } = useAppSettings();
  const overlay = usePlatformEmitterOverlay(platformId);

  if (isLoading) return <p className="hint-text">Loading dwells…</p>;
  return (
    <div className="platform-dwells">
      <div className="platform-dwells-head">
        <p className="hint-text">
          This Platform&apos;s Dwell Strategies. The chart shows the picked one with the frequencies its pinned Emitters
          occupy behind it.
        </p>
        <RequireRole minimum="editor">
          <button type="button" className="button secondary small" onClick={() => setMaking(true)}>
            + Add Strategy
          </button>
        </RequireRole>
      </div>
      {!strategies?.length ? (
        <>
          <p className="hint-text dwell-empty">
            No Strategies for {platformName} yet. Make one here, or give an imported one this Platform on its page under{" "}
            <Link to="/dwells">Dwells</Link>. The chart shows where its Emitters transmit, to plan the dwells against.
          </p>
          <DwellChart
            dwells={[]}
            bandwidthMhz={settings?.dwell_bandwidth_mhz ?? 10}
            title={`${platformName}'s Emitters`}
            overlay={overlay}
            overlayTitle={`${platformName}'s Emitters`}
            emptyText="No Strategy yet."
          />
        </>
      ) : (
        <>
          <table className="data-table dwell-strategy-list platform-dwells-table">
            <thead>
              <tr>
                <th>Strategy</th>
                <th className="num">Dwells</th>
                <th>Range (MHz)</th>
                <th className="num">Cycle (ms)</th>
                <th>Version</th>
                <th>In files</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {strategies.map((s) => (
                <tr
                  key={s.id}
                  className={s.id === selectedId ? "dwell-pick-row picked" : "dwell-pick-row"}
                  onClick={() => setPicked(s.id)}
                  aria-selected={s.id === selectedId}
                >
                  <td>
                    <Link to={`/dwells/strategies/${s.id}`} onClick={(e) => e.stopPropagation()}>
                      {s.name}
                    </Link>
                    {s.platform_names.length > 1 && (
                      <span className="hint-text">
                        {" "}
                        · also {s.platform_names.filter((n) => n !== platformName).join(", ")}
                      </span>
                    )}
                    {s.description && <div className="dwell-desc">{s.description}</div>}
                  </td>
                  <td className="num">{s.dwell_count}</td>
                  <td className="nowrap">
                    {s.lowest_mhz != null && s.highest_mhz != null ? `${num(s.lowest_mhz)}–${num(s.highest_mhz)}` : "—"}
                  </td>
                  <td className="num">{s.cycle_ms ? num(s.cycle_ms) : "—"}</td>
                  <td className="nowrap">
                    {s.latest_version_number ? `v${s.latest_version_number}` : "—"}
                    {s.unsaved && s.latest_version_number != null && (
                      <span className="dwell-dot" title={`Changed since v${s.latest_version_number}`} aria-label="changed" />
                    )}
                  </td>
                  <td title={s.used_in.join("\n")}>{s.used_in.join(", ") || <span className="hint-text">—</span>}</td>
                  <td className="nowrap">{formatDate(s.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {strategy && strategy.id === selectedId && (
            <DwellChart
              key={strategy.id}
              dwells={strategy.dwells}
              bandwidthMhz={strategy.bandwidth_mhz ?? settings?.dwell_bandwidth_mhz ?? 10}
              title={`${strategy.name} — as it stands now`}
              overlay={overlay}
              overlayTitle={`${platformName}'s Emitters`}
            />
          )}
          {overlay && overlay.length === 0 && (
            <p className="hint-text">Pin Emitter versions on this Platform to see the frequencies they occupy on the chart.</p>
          )}
        </>
      )}
      {making && <NewStrategy platformId={platformId} onClose={() => setMaking(false)} />}
    </div>
  );
}
