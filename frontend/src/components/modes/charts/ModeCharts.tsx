import { useMemo, useState } from "react";
import { useEmitterInterceptEntries } from "../../../state/hooks/useIntercepts";
import { matchEntry } from "../../intercepts/interceptMatch";
import type { Mode } from "../../../types/domain";
import { modeRanges, RESULT_STATUS, type ModeRanges } from "./modeRanges";
import { ModeMap, spanOf, valueOf, type MapEntry, type MapParam } from "./ModeMap";

const AXES_KEY = "modeMapAxes";
const PARAM_KEYS: MapParam[] = ["rf", "pri", "pw"];

function readAxes(): { x: MapParam; y: MapParam } {
  try {
    const stored = JSON.parse(localStorage.getItem(AXES_KEY) ?? "null") as { x?: string; y?: string } | null;
    const x = PARAM_KEYS.find((p) => p === stored?.x);
    const y = PARAM_KEYS.find((p) => p === stored?.y);
    if (x && y && x !== y) return { x, y };
  } catch {
    // Unreadable — use the default.
  }
  return { x: "rf", y: "pri" };
}
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
  // Which two parameters the map shows — remembered in this browser.
  const [axes, setAxesState] = useState(readAxes);
  function setAxes(x: MapParam, y: MapParam) {
    setAxesState({ x, y });
    try {
      localStorage.setItem(AXES_KEY, JSON.stringify({ x, y }));
    } catch {
      // Not remembered — fine.
    }
  }
  const ranges = useMemo(() => modes.map(modeRanges).filter((r): r is ModeRanges => !!r), [modes]);
  const entries: MapEntry[] = useMemo(
    () =>
      (interceptEntries ?? []).map((e) => ({
        rf: e.rf_mean_mhz,
        pri: e.pri_mean_us,
        pw: e.pw_mean_us,
        matched: matchEntry(e, allModes).status === "match",
        label: e.notes ?? "",
      })),
    [interceptEntries, allModes],
  );
  const shownEntries = showEntries ? entries : [];
  const unmatched = entries.filter((e) => !e.matched).length;
  const skipped = modes.length - ranges.length;
  // Entries beyond every Mode's reach on the map's two parameters — off the
  // chart unless fitted to them.
  const offChart = useMemo(() => {
    const reach = (p: MapParam) => {
      const spans = ranges.flatMap((r) => (spanOf(r, p) ? [spanOf(r, p)!] : []));
      return spans.length ? [Math.min(...spans.map((s) => s[0])), Math.max(...spans.map((s) => s[1]))] : null;
    };
    const rx = reach(axes.x);
    const ry = reach(axes.y);
    const outside = (v: number | null, r: number[] | null) => v != null && r != null && (v < r[0] || v > r[1]);
    return entries.filter((e) => outside(valueOf(e, axes.x), rx) || outside(valueOf(e, axes.y), ry)).length;
  }, [ranges, entries, axes]);

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
      <ModeMap
        ranges={ranges}
        entries={shownEntries}
        fitEntries={fitEntries}
        xParam={axes.x}
        yParam={axes.y}
        onAxes={setAxes}
        onOpen={onOpen}
      />
      <ModeLadders ranges={ranges} entries={shownEntries} fitEntries={fitEntries} onOpen={onOpen} />
    </div>
  );
}
