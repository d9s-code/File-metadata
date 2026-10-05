import { useMemo, useState } from "react";
import { useEmitterInterceptEntries } from "../../../state/hooks/useIntercepts";
import { matchEntry } from "../../intercepts/interceptMatch";
import { fmt } from "../../intercepts/charts/Histogram";
import type { Mode } from "../../../types/domain";
import {
  modeRanges,
  resultStatus,
  RESULT_STATUS,
  SERIES_SLOTS,
  type AxisLimit,
  type AxisLimits,
  type ChartParam,
  type ModeRanges,
  type Paint,
} from "./modeRanges";
import { ModeMap, spanOf, valueOf, type MapEntry, type MapParam } from "./ModeMap";
import { ModeLadders } from "./ModeLadders";

const AXES_KEY = "modeMapAxes";
const COLOUR_KEY = "modeChartColour";
const LIMITS_KEY = "modeChartLimits";
const PICKED_KEY = (emitterId: string) => `modeChartColours:${emitterId}`;
const PARAM_KEYS: MapParam[] = ["rf", "pri", "pw"];
const LIMIT_PARAMS: { key: ChartParam; label: string; unit: string }[] = [
  { key: "rf", label: "RF", unit: "MHz" },
  { key: "pri", label: "PRI / frame time", unit: "µs" },
  { key: "pw", label: "PW", unit: "µs" },
];

type ColourBy = "result" | "mode";
type LimitText = Partial<Record<ChartParam, { min: string; max: string }>>;
/** Mode id → its colour slot, 1 to SERIES_SLOTS. */
type Picked = Record<string, number>;

function read<T>(key: string, check: (v: unknown) => T | null, fallback: T): T {
  try {
    return check(JSON.parse(localStorage.getItem(key) ?? "null")) ?? fallback;
  } catch {
    // Unreadable — use the default.
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Not remembered — fine.
  }
}

function readAxes(): { x: MapParam; y: MapParam } {
  return read(
    AXES_KEY,
    (v) => {
      const stored = v as { x?: string; y?: string } | null;
      const x = PARAM_KEYS.find((p) => p === stored?.x);
      const y = PARAM_KEYS.find((p) => p === stored?.y);
      return x && y && x !== y ? { x, y } : null;
    },
    { x: "rf", y: "pri" },
  );
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** A typed bound as a number; blank or unreadable is no bound. */
function bound(text: string | undefined): number | undefined {
  if (text == null || text.trim() === "") return undefined;
  const n = Number(text);
  return Number.isFinite(n) ? n : undefined;
}

/** The typed bounds, minus any pair that doesn't make sense (min ≥ max). */
function parseLimits(text: LimitText): { limits: AxisLimits; invalid: Set<ChartParam> } {
  const limits: AxisLimits = {};
  const invalid = new Set<ChartParam>();
  for (const { key } of LIMIT_PARAMS) {
    const min = bound(text[key]?.min);
    const max = bound(text[key]?.max);
    if (min != null && max != null && min >= max) {
      invalid.add(key);
      continue;
    }
    if (min != null || max != null) limits[key] = { min, max };
  }
  return { limits, invalid };
}

/** The first SERIES_SLOTS Modes by name get a colour each — taken from every
 * Mode, not just the filtered ones, so filtering never repaints a Mode. */
function defaultPicked(allModes: Mode[]): Picked {
  const sorted = [...allModes].sort((a, b) => a.name.localeCompare(b.name));
  return Object.fromEntries(sorted.slice(0, SERIES_SLOTS).map((m, i) => [m.id, i + 1]));
}

/** The Modes tab's Charts view: the Modes on two chosen parameters, and their
 * ranges per parameter, coloured by last test result or one colour per Mode,
 * with this Emitter's intercept entries marked. The axes fit the Modes unless
 * the user sets their bounds. Shows the Modes the tab's filters leave;
 * entries are matched against all of them. */
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
  // Which two parameters the map shows, how Modes are coloured and the axis
  // bounds — remembered in this browser, for every Emitter alike.
  const [axes, setAxesState] = useState(readAxes);
  function setAxes(x: MapParam, y: MapParam) {
    setAxesState({ x, y });
    write(AXES_KEY, { x, y });
  }
  const [colourBy, setColourByState] = useState<ColourBy>(() =>
    read<ColourBy>(COLOUR_KEY, (v) => (v === "mode" || v === "result" ? v : null), "result"),
  );
  function setColourBy(value: ColourBy) {
    setColourByState(value);
    write(COLOUR_KEY, value);
  }
  const [limitText, setLimitTextState] = useState<LimitText>(() =>
    read<LimitText>(LIMITS_KEY, (v) => (isRecord(v) ? (v as LimitText) : null), {}),
  );
  function setLimitText(next: LimitText) {
    setLimitTextState(next);
    write(LIMITS_KEY, Object.keys(next).length ? next : null);
  }
  function setBound(key: ChartParam, side: "min" | "max", value: string) {
    const current = { min: "", max: "", ...limitText[key], [side]: value };
    const next = { ...limitText };
    if (current.min.trim() === "" && current.max.trim() === "") delete next[key];
    else next[key] = current;
    setLimitText(next);
  }
  const { limits, invalid } = useMemo(() => parseLimits(limitText), [limitText]);

  // Which Modes have a colour of their own — remembered per Emitter, once
  // changed from the default.
  const readPicked = (id: string) => read<Picked | null>(PICKED_KEY(id), (v) => (isRecord(v) ? (v as Picked) : null), null);
  const [pickedStore, setPickedStore] = useState(() => ({ emitterId, value: readPicked(emitterId) }));
  // Another Emitter's page reusing this component: its own choice.
  const pickedState = pickedStore.emitterId === emitterId ? pickedStore.value : readPicked(emitterId);
  const picked = useMemo(() => {
    if (!pickedState) return defaultPicked(allModes);
    const ids = new Set(allModes.map((m) => m.id));
    return Object.fromEntries(Object.entries(pickedState).filter(([id]) => ids.has(id)));
  }, [pickedState, allModes]);
  function setPicked(next: Picked | null) {
    setPickedStore({ emitterId, value: next });
    write(PICKED_KEY(emitterId), next);
  }
  const [full, setFull] = useState(false);
  function toggleColour(mode: Mode) {
    setFull(false);
    if (picked[mode.id]) {
      const next = { ...picked };
      delete next[mode.id];
      setPicked(next);
      return;
    }
    // The lowest free colour, so the others keep theirs.
    const used = new Set(Object.values(picked));
    const slot = Array.from({ length: SERIES_SLOTS }, (_, i) => i + 1).find((n) => !used.has(n));
    if (!slot) {
      setFull(true);
      return;
    }
    setPicked({ ...picked, [mode.id]: slot });
  }
  const [highlight, setHighlight] = useState<string | null>(null);

  const paint: Paint = useMemo(
    () =>
      colourBy === "mode"
        ? (mode) => {
            const slot = picked[mode.id];
            return slot ? { cls: `series-${slot}`, label: mode.name } : { cls: "series-other", label: "Other Modes" };
          }
        : resultStatus,
    [colourBy, picked],
  );

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

  // Every Mode's reach on each parameter, for the bounds' placeholders and
  // what lies off the charts.
  const reach = useMemo(() => {
    const out: Partial<Record<ChartParam, [number, number]>> = {};
    for (const { key } of LIMIT_PARAMS) {
      const spans = ranges.flatMap((r) => (spanOf(r, key) ? [spanOf(r, key)!] : []));
      if (spans.length) out[key] = [Math.min(...spans.map((s) => s[0])), Math.max(...spans.map((s) => s[1]))];
    }
    return out;
  }, [ranges]);

  // Entries beyond every Mode's reach on the map's two parameters, on a side
  // whose bound isn't set — off the chart unless fitted to them.
  const offChart = useMemo(() => {
    const outside = (v: number | null, p: MapParam) => {
      const r = reach[p];
      const lim: AxisLimit = limits[p] ?? {};
      if (v == null || !r) return false;
      return (lim.min == null && v < r[0]) || (lim.max == null && v > r[1]);
    };
    return entries.filter((e) => outside(valueOf(e, axes.x), axes.x) || outside(valueOf(e, axes.y), axes.y)).length;
  }, [reach, limits, entries, axes]);
  // Modes reaching past the bounds the user set — cut at the edge.
  const pastBounds = useMemo(
    () =>
      ranges.filter((r) =>
        LIMIT_PARAMS.some(({ key }) => {
          const s = spanOf(r, key);
          const lim = limits[key];
          return !!s && !!lim && ((lim.min != null && s[0] < lim.min) || (lim.max != null && s[1] > lim.max));
        }),
      ).length,
    [ranges, limits],
  );
  const anyBounds = Object.keys(limitText).length > 0;
  const colouredShown = ranges.filter((r) => picked[r.mode.id]).length;

  return (
    <div className="mode-charts">
      <div className="chart-controls">
        <div className="chart-controls-row">
          <strong>Colour</strong>
          <label className="inline-label">
            <input type="radio" name="mode-chart-colour" checked={colourBy === "result"} onChange={() => setColourBy("result")} />
            By last test result
          </label>
          <label className="inline-label">
            <input type="radio" name="mode-chart-colour" checked={colourBy === "mode"} onChange={() => setColourBy("mode")} />
            By Mode
          </label>
        </div>
        {colourBy === "mode" && ranges.length > 0 && (
          <div className="chart-controls-row">
            <strong>Modes</strong>
            <span className="mode-legend" onPointerLeave={() => setHighlight(null)}>
              {ranges.map((r) => {
                const on = !!picked[r.mode.id];
                return (
                  <button
                    key={r.mode.id}
                    type="button"
                    className={on ? "mode-legend-chip" : "mode-legend-chip off"}
                    aria-pressed={on}
                    title={on ? "Click to make it grey again" : "Click to give it a colour of its own"}
                    onClick={() => toggleColour(r.mode)}
                    onPointerEnter={() => setHighlight(r.mode.id)}
                    onFocus={() => setHighlight(r.mode.id)}
                    onBlur={() => setHighlight(null)}
                  >
                    <span className={`viz-swatch ${paint(r.mode).cls}`} />
                    {r.mode.name}
                  </button>
                );
              })}
            </span>
          </div>
        )}
        <div className="chart-controls-row">
          <strong>Axis ranges</strong>
          {LIMIT_PARAMS.map(({ key, label, unit }) => (
            <span key={key} className="chart-scale-param">
              {label}
              <input
                type="number"
                step="any"
                inputMode="decimal"
                aria-label={`${label} axis from (${unit})`}
                aria-invalid={invalid.has(key) || undefined}
                placeholder={reach[key] ? fmt(reach[key]![0]) : "min"}
                value={limitText[key]?.min ?? ""}
                onChange={(e) => setBound(key, "min", e.target.value)}
              />
              –
              <input
                type="number"
                step="any"
                inputMode="decimal"
                aria-label={`${label} axis to (${unit})`}
                aria-invalid={invalid.has(key) || undefined}
                placeholder={reach[key] ? fmt(reach[key]![1]) : "max"}
                value={limitText[key]?.max ?? ""}
                onChange={(e) => setBound(key, "max", e.target.value)}
              />
              <span className="hint-text">{unit}</span>
            </span>
          ))}
          {anyBounds && (
            <button type="button" className="link-button" onClick={() => setLimitText({})}>
              Fit to the Modes
            </button>
          )}
        </div>
        <p className="hint-text" style={{ margin: 0 }}>
          {invalid.size > 0
            ? `A range's start must be below its end — ${LIMIT_PARAMS.filter((p) => invalid.has(p.key))
                .map((p) => p.label)
                .join(", ")} still fit${invalid.size === 1 ? "s" : ""} the Modes. `
            : ""}
          Leave a box blank to fit the Modes on that side. The ranges are kept in this browser for every Emitter, so
          Emitters can be compared on the same scale.
          {pastBounds > 0 &&
            ` ${pastBounds} Mode${pastBounds === 1 ? " reaches" : "s reach"} past them — cut at the edge, or marked ◂ ▸ in the ladders when wholly outside.`}
        </p>
      </div>
      <div className="viz-summary">
        <span className="viz-legend">
          {colourBy === "result" ? (
            (["pass", "partial", "fail", "untested"] as const).map((k) => (
              <span key={k}>
                <span className={`viz-swatch ${RESULT_STATUS[k].cls}`} /> {RESULT_STATUS[k].label}
              </span>
            ))
          ) : (
            <span>
              <span className="viz-swatch series-other" /> Other Modes (no colour of their own)
            </span>
          )}
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
        {colourBy === "result" ? (
          "Coloured by each Mode's last test result. "
        ) : (
          <>
            One colour per Mode, {SERIES_SLOTS} at most at once ({colouredShown} shown) — click a name above to give
            it a colour or make it grey; point at one to pick it out in the charts.{" "}
            {full && <strong>All {SERIES_SLOTS} colours are in use — make one grey first. </strong>}
            <button type="button" className="link-button" onClick={() => setPicked(null)}>
              First {SERIES_SLOTS} by name
            </button>{" "}
            ·{" "}
            <button type="button" className="link-button" onClick={() => setPicked({})}>
              All grey
            </button>{" "}
          </>
        )}
        Engineered ranges (raw ± delta), the ones the system recognises.
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
        limits={limits}
        paint={paint}
        highlight={colourBy === "mode" ? highlight : null}
        xParam={axes.x}
        yParam={axes.y}
        onAxes={setAxes}
        onOpen={onOpen}
      />
      <ModeLadders
        ranges={ranges}
        entries={shownEntries}
        fitEntries={fitEntries}
        limits={limits}
        paint={paint}
        highlight={colourBy === "mode" ? highlight : null}
        onOpen={onOpen}
      />
    </div>
  );
}
