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
  type ChartEntry,
  type ModeRanges,
  type Paint,
  spanOf,
  valueOf,
} from "./modeRanges";
import { ModeLadders } from "./ModeLadders";

const COLOUR_KEY = "modeChartColour";
const LIMITS_KEY = "modeChartLimits";
const PICKED_KEY = (emitterId: string) => `modeChartColours:${emitterId}`;
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

/** The Modes tab's Charts view: each Mode's ranges per parameter, coloured by
 * last test result or one colour per Mode,
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
  // How Modes are coloured and the axis bounds — remembered in this browser,
  // for every Emitter alike.
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
  const [onlyColoured, setOnlyColoured] = useState(false);

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
  const entries: ChartEntry[] = useMemo(
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

  // Entries beyond every Mode's reach, on a side whose bound isn't set — off
  // the charts unless fitted to them.
  const offChart = useMemo(() => {
    const outside = (v: number | null, p: ChartParam) => {
      const r = reach[p];
      const lim: AxisLimit = limits[p] ?? {};
      if (v == null || !r) return false;
      return (lim.min == null && v < r[0]) || (lim.max == null && v > r[1]);
    };
    return entries.filter((e) => LIMIT_PARAMS.some(({ key }) => outside(valueOf(e, key), key))).length;
  }, [reach, limits, entries]);
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
  const byMode = colourBy === "mode";
  // The coloured Modes, by colour; the grey ones by name for the picker.
  const coloured = ranges.filter((r) => picked[r.mode.id]).sort((a, b) => picked[a.mode.id] - picked[b.mode.id]);
  const grey = ranges.filter((r) => !picked[r.mode.id]).sort((a, b) => a.mode.name.localeCompare(b.mode.name));
  const used = Object.keys(picked).length;
  const drawn = byMode && onlyColoured ? coloured : ranges;

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
        {byMode && ranges.length > 0 && (
          <div className="chart-controls-row">
            <strong>Coloured</strong>
            {/* Only the coloured Modes are listed — eight at most, however many Modes there are. */}
            <span className="mode-legend" onPointerLeave={() => setHighlight(null)}>
              {coloured.length === 0 && <span className="hint-text">None — every Mode is grey.</span>}
              {coloured.map((r) => (
                <button
                  key={r.mode.id}
                  type="button"
                  className="mode-legend-chip"
                  title="Point at it to pick it out in the chart; click to make it grey"
                  aria-label={`${r.mode.name} — make grey`}
                  onClick={() => toggleColour(r.mode)}
                  onPointerEnter={() => setHighlight(r.mode.id)}
                  onFocus={() => setHighlight(r.mode.id)}
                  onBlur={() => setHighlight(null)}
                >
                  <span className={`viz-swatch ${paint(r.mode).cls}`} />
                  {r.mode.name}
                  <span className="mode-legend-x" aria-hidden>
                    ×
                  </span>
                </button>
              ))}
            </span>
            {grey.length > 0 && (
              <select
                className="mode-colour-pick"
                aria-label="Give a Mode a colour"
                value=""
                disabled={used >= SERIES_SLOTS}
                title={used >= SERIES_SLOTS ? `All ${SERIES_SLOTS} colours are in use — make one grey first` : undefined}
                onChange={(e) => {
                  const mode = grey.find((r) => r.mode.id === e.target.value)?.mode;
                  if (mode) toggleColour(mode);
                }}
              >
                <option value="">
                  {used >= SERIES_SLOTS ? `All ${SERIES_SLOTS} colours in use` : `+ Colour a Mode (${grey.length} grey)…`}
                </option>
                {grey.map((r) => (
                  <option key={r.mode.id} value={r.mode.id}>
                    {r.mode.name}
                  </option>
                ))}
              </select>
            )}
            <span className="hint-text">
              <button type="button" className="link-button" onClick={() => setPicked(null)}>
                First {SERIES_SLOTS} by name
              </button>{" "}
              ·{" "}
              <button type="button" className="link-button" onClick={() => setPicked({})}>
                All grey
              </button>
            </span>
            <label className="inline-label">
              <input type="checkbox" checked={onlyColoured} onChange={(e) => setOnlyColoured(e.target.checked)} />
              Only the coloured Modes
            </label>
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
            ` ${pastBounds} Mode${pastBounds === 1 ? " reaches" : "s reach"} past them — cut at the edge, or marked ◂ ▸ when wholly outside.`}
        </p>
      </div>
      <div className="viz-summary">
        <span className="viz-legend">
          {!byMode ? (
            (["pass", "partial", "fail", "untested"] as const).map((k) => (
              <span key={k}>
                <span className={`viz-swatch ${RESULT_STATUS[k].cls}`} /> {RESULT_STATUS[k].label}
              </span>
            ))
          ) : (
            !onlyColoured && (
              <span>
                <span className="viz-swatch series-other" /> Other Modes (no colour of their own)
              </span>
            )
          )}
          {entries.length > 0 && showEntries && (
            <>
              <span>
                <span className="viz-swatch entry-tick" /> Intercept entry matching a Mode
              </span>
              <span>
                <span className="viz-swatch entry-tick out" /> Intercept entry outside every Mode
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
        {!byMode ? (
          "Coloured by each Mode's last test result. "
        ) : (
          <>
            One colour per Mode, {SERIES_SLOTS} at most at once — add one with the list above or by clicking a
            Mode&apos;s square in the chart; click again to make it grey.{" "}
            {full && <strong>All {SERIES_SLOTS} colours are in use — make one grey first. </strong>}
          </>
        )}
        Engineered ranges (raw ± delta), the ones the system recognises.
        {skipped > 0 && ` ${skipped} Mode${skipped === 1 ? " has" : "s have"} no values yet and aren't drawn.`}
        {showEntries && offChart > 0 && (
          <>
            {" "}
            {offChart} intercept entr{offChart === 1 ? "y lies" : "ies lie"} beyond every Mode
            {fitEntries ? " — the axes are fitted to include them." : " and off the chart — "}
            <button type="button" className="link-button" onClick={() => setFitEntries(!fitEntries)}>
              {fitEntries ? "Fit to the Modes" : "Fit to Modes and entries"}
            </button>
          </>
        )}
      </p>
      <ModeLadders
        ranges={drawn}
        entries={shownEntries}
        fitEntries={fitEntries}
        limits={limits}
        paint={paint}
        highlight={byMode ? highlight : null}
        onToggleColour={byMode ? toggleColour : undefined}
        onOpen={onOpen}
      />
    </div>
  );
}
