import { useMemo, useState } from "react";
import { useEmitterInterceptEntries } from "../../../state/hooks/useIntercepts";
import { matchEntry } from "../../intercepts/interceptMatch";
import type { Mode } from "../../../types/domain";
import { modeRanges, RESULT_STATUS, type ModeRanges } from "./modeRanges";
import { ModeMap, type MapEntry } from "./ModeMap";
import { ModeLadders } from "./ModeLadders";

/** The Modes tab's Charts view: the Modes on RF × PRI, and their ranges per
 * parameter, coloured by last test result, with this Emitter's intercept
 * entries marked. Shows the Modes the tab's filters leave; entries are
 * matched against all of them. */
export function ModeCharts({
  emitterId,
  modes,
  allModes,
  onOpen,
}: {
  emitterId: string;
  modes: Mode[];
  allModes: Mode[];
  onOpen: (mode: Mode) => void;
}) {
  const { data: interceptEntries } = useEmitterInterceptEntries(emitterId);
  const [showEntries, setShowEntries] = useState(true);
  const [fitEntries, setFitEntries] = useState(false);
  const ranges = useMemo(() => modes.map(modeRanges).filter((r): r is ModeRanges => !!r), [modes]);
  const entries: MapEntry[] = useMemo(
    () =>
      (interceptEntries ?? []).map((e) => ({
        rf: e.rf_mean_mhz,
        pri: e.pri_mean_us,
        matched: matchEntry(e, allModes).status === "match",
        label: e.notes ?? "",
      })),
    [interceptEntries, allModes],
  );
  const shownEntries = showEntries ? entries : [];
  const unmatched = entries.filter((e) => !e.matched).length;
  const skipped = modes.length - ranges.length;
  // Entries beyond every Mode's reach — off the chart unless fitted to them.
  const offChart = useMemo(() => {
    if (ranges.length === 0) return 0;
    const rf = [Math.min(...ranges.map((r) => r.rf[0])), Math.max(...ranges.map((r) => r.rf[1]))];
    const pris = ranges.flatMap((r) => (r.pri ? [r.pri] : []));
    const pri = pris.length ? [Math.min(...pris.map((p) => p[0])), Math.max(...pris.map((p) => p[1]))] : null;
    return entries.filter(
      (e) => e.rf < rf[0] || e.rf > rf[1] || (pri != null && e.pri != null && (e.pri < pri[0] || e.pri > pri[1])),
    ).length;
  }, [ranges, entries]);

  return (
    <div className="mode-charts">
      <div className="viz-summary">
        <span className="viz-legend">
          {(["pass", "partial", "fail", "untested"] as const).map((k) => (
            <span key={k}>
              <span className={`viz-swatch ${RESULT_STATUS[k].cls}`} /> {RESULT_STATUS[k].label}
            </span>
          ))}
          {entries.length > 0 && showEntries && (
            <>
              <span>
                <span className="viz-swatch map-entry-swatch" /> Intercept entry matching a Mode
              </span>
              <span>
                <span className="map-cross-swatch">✕</span> Intercept entry outside every Mode
              </span>
            </>
          )}
        </span>
        {entries.length > 0 && (
          <label className="inline-label">
            <input type="checkbox" checked={showEntries} onChange={(e) => setShowEntries(e.target.checked)} />
            Show {entries.length} intercept entr{entries.length === 1 ? "y" : "ies"}
            {unmatched > 0 && ` (${unmatched} outside every Mode)`}
          </label>
        )}
      </div>
      <p className="hint-text">
        Coloured by each Mode&apos;s last test result. Engineered ranges (raw ± delta), the ones the system recognises.
        {skipped > 0 && ` ${skipped} Mode${skipped === 1 ? " has" : "s have"} no values yet and aren't drawn.`}
        {showEntries && offChart > 0 && (
          <>
            {" "}
            {offChart} intercept entr{offChart === 1 ? "y lies" : "ies lie"} beyond every Mode
            {fitEntries ? " — the axes are fitted to include them." : " and off the charts — "}
            <button type="button" className="link-button" onClick={() => setFitEntries(!fitEntries)}>
              {fitEntries ? "Fit to the Modes" : "Fit to Modes and entries"}
            </button>
          </>
        )}
      </p>
      <ModeMap ranges={ranges} entries={shownEntries} fitEntries={fitEntries} onOpen={onOpen} />
      <ModeLadders ranges={ranges} entries={shownEntries} fitEntries={fitEntries} onOpen={onOpen} />
    </div>
  );
}
