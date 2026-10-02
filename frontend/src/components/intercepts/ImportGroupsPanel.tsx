import { Fragment, useEffect, useMemo, useState } from "react";
import type { CsvReport, ReportPriType } from "./interceptCsv";
import { formatMissionTime } from "./interceptCsv";
import {
  AUTO_GROUP_RULE,
  autoGroup,
  cannotMerge,
  groupReports,
  mergeGroups,
  oneGroupPerReport,
  setExcluded,
  splitAtValue,
  splitGroups,
  summarize,
  takeOut,
  type AutoGroupResult,
  type GapSettings,
  type GroupSummary,
  type Measured,
  type ReportGroup,
  type SplitParam,
} from "./interceptGroups";
import { matchEntry } from "./interceptMatch";
import { EntryMatchCell } from "./EntryMatchCell";
import { useConfirmDialog } from "../common/ConfirmDialog";
import { ImportCharts, type Range, type RangeParam } from "./charts/ImportCharts";
import type { Mode } from "../../types/domain";

const PAGE_SIZE = 100;
const REPORTS_SHOWN = 50;
const TYPE_LABEL: Record<ReportPriType, string> = { fixed: "Fixed", stagger: "Stagger", cw: "CW" };
const TYPE_ORDER: Record<ReportPriType, number> = { fixed: 0, stagger: 1, cw: 2 };

interface Filters {
  type: "" | ReportPriType;
  rfMin: string;
  rfMax: string;
  priMin: string;
  priMax: string;
  pwMin: string;
  pwMax: string;
  track: string;
  identified: string;
  show: "all" | "included" | "excluded" | "strays" | "selected" | "marked";
}
const NO_FILTERS: Filters = {
  type: "",
  rfMin: "",
  rfMax: "",
  priMin: "",
  priMax: "",
  pwMin: "",
  pwMax: "",
  track: "",
  identified: "",
  show: "all",
};

/** A gap slider: logarithmic, so the small values that matter get most
 * of its travel; far left is 0. The number beside it takes any value. */
const SLIDER_STEPS = 1000;
function GapSlider({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: string;
  /** Smallest non-zero value the slider reaches. */
  min: number;
  max: number;
  onChange: (value: string) => void;
}) {
  const v = Number(value) || 0;
  const pos = v <= 0 ? 0 : Math.round((Math.log(Math.min(Math.max(v, min), max) / min) / Math.log(max / min)) * SLIDER_STEPS);
  const fromPos = (p: number) => {
    if (p <= 0) return "0";
    const raw = min * (max / min) ** (p / SLIDER_STEPS);
    return String(Number(raw.toPrecision(2)));
  };
  return (
    <label className="tolerance-slider">
      {label}
      <span>
        <input
          type="range"
          min={0}
          max={SLIDER_STEPS}
          value={pos}
          aria-label={`${label} slider`}
          onChange={(e) => onChange(fromPos(Number(e.target.value)))}
        />
        <input type="number" step="any" min="0" value={value} onChange={(e) => onChange(e.target.value)} />
      </span>
    </label>
  );
}

const CHARTS_OPEN_KEY = "import-charts-open";
const CHART_TAB_KEY = "import-chart-tab";
type ChartTab = "distributions" | "time";

/** An open/closed panel, remembered in this browser. */
function useRememberedOpen(key: string, initial: boolean) {
  const [open, setOpenState] = useState(() => {
    try {
      const v = localStorage.getItem(key);
      return v == null ? initial : v === "true";
    } catch {
      return initial;
    }
  });
  function setOpen(next: boolean) {
    setOpenState(next);
    try {
      localStorage.setItem(key, String(next));
    } catch {
      // Not remembered — fine.
    }
  }
  return [open, setOpen] as const;
}
const SPLIT_LABEL: Record<SplitParam, string> = { rf: "RF (MHz)", pri: "PRI / frame time (µs)", pw: "PW (µs)" };

interface Row {
  group: ReportGroup;
  summary: GroupSummary;
}

function inRange(m: Measured | null, lo: string, hi: string) {
  if (lo === "" && hi === "") return true;
  if (m == null) return false;
  if (lo !== "" && m.mean < Number(lo)) return false;
  if (hi !== "" && m.mean > Number(hi)) return false;
  return true;
}

function Value({ m, single }: { m: Measured | null; single: boolean }) {
  if (m == null) return <span className="hint-text">—</span>;
  return (
    <>
      <strong>{m.mean}</strong>
      {!single && m.min !== m.max && (
        <div className="hint-text cell-subline">
          {m.min}–{m.max}
        </div>
      )}
    </>
  );
}

/** The grouping step of the CSV import: each group becomes one entry. The
 * user does the grouping — by selecting rows and merging them, splitting at a
 * value, or with Auto group and the gaps they set; nothing regroups on its own. */
export function ImportGroupsPanel({
  reports,
  groups,
  onChange,
  modes,
  emitterId,
  defaultShow = "all",
  heading = "3. Group reports into entries",
  startsFrom,
}: {
  heading?: string;
  /** Where the rows start from, said in the intro — the import starts with one per report. */
  startsFrom?: string;
  /** Which rows the table lists at first — the regroup page starts with the included ones. */
  defaultShow?: Filters["show"];
  reports: CsvReport[];
  groups: ReportGroup[];
  onChange: (groups: ReportGroup[]) => void;
  modes: Mode[] | undefined;
  emitterId: string;
}) {
  const byLine = useMemo(() => new Map(reports.map((r) => [r.line, r])), [reports]);
  // The line in its file — reports loaded back from an Intercept are numbered
  // apart from their file lines (an Intercept can hold several files).
  const fileLine = (line: number) => {
    const r = byLine.get(line);
    return r?.fileLine != null ? `${r.sourceFile && multiFile ? `${r.sourceFile} ` : ""}${r.fileLine}` : String(line);
  };
  const multiFile = useMemo(() => new Set(reports.map((r) => r.sourceFile).filter(Boolean)).size > 1, [reports]);
  const [filters, setFilters] = useState<Filters>({ ...NO_FILTERS, show: defaultShow });
  const [gap, setGap] = useState({ rfMhz: "1", priUs: "1", pwUs: "0.1", minReports: "5", sameTrack: false });
  // Splitting the selected rows at a value: which parameter, and where.
  const [splitting, setSplitting] = useState<{ param: SplitParam; value: string } | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [page, setPage] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const { confirmDelete: confirm, dialog } = useConfirmDialog();
  const [chartsOpen, setChartsOpen] = useRememberedOpen(CHARTS_OPEN_KEY, true);
  const [chartTab, setChartTabState] = useState<ChartTab>(() => {
    try {
      return localStorage.getItem(CHART_TAB_KEY) === "time" ? "time" : "distributions";
    } catch {
      return "distributions";
    }
  });
  function setChartTab(tab: ChartTab) {
    setChartTabState(tab);
    setChartsOpen(true);
    try {
      localStorage.setItem(CHART_TAB_KEY, tab);
    } catch {
      // Not remembered — fine.
    }
  }

  const rows: Row[] = useMemo(
    () =>
      groups
        .map((group) => ({ group, summary: summarize(group.lines.map((l) => byLine.get(l)!)) }))
        .sort(
          (a, b) =>
            TYPE_ORDER[a.summary.priType] - TYPE_ORDER[b.summary.priType] ||
            a.summary.rf.mean - b.summary.rf.mean ||
            a.group.id - b.group.id,
        ),
    [groups, byLine],
  );
  const identifications = useMemo(
    () => [...new Set(reports.map((r) => r.designation ?? "not identified"))].sort(),
    [reports],
  );

  // Reports marked on the Over time charts, and how many of them each row holds.
  const [markedLines, setMarkedLines] = useState<Set<number>>(() => new Set());
  const markedPerRow = useMemo(() => {
    const out = new Map<number, number>();
    if (markedLines.size === 0) return out;
    for (const g of groups) {
      let n = 0;
      for (const l of g.lines) if (markedLines.has(l)) n++;
      if (n > 0) out.set(g.id, n);
    }
    return out;
  }, [groups, markedLines]);
  // The reports of the selected rows — highlighted on the charts while nothing is marked.
  const selectedLines = useMemo(
    () => new Set(groups.filter((g) => selected.has(g.id)).flatMap((g) => g.lines)),
    [groups, selected],
  );
  // A row to bring into view once it's rendered — a group just made from marked reports.
  const [jumpTo, setJumpTo] = useState<number | null>(null);

  const visible = useMemo(() => {
    const f = filters;
    const track = f.track.trim();
    return rows.filter(({ group, summary: s }) => {
      if (f.show === "selected") {
        if (!selected.has(group.id)) return false;
      } else if (f.show === "marked") {
        if (!markedPerRow.has(group.id)) return false;
      } else if (f.show === "strays" ? !group.stray : group.stray) return false;
      if (f.show === "included" && group.excluded) return false;
      if (f.show === "excluded" && !group.excluded) return false;
      if (f.type && s.priType !== f.type) return false;
      if (!inRange(s.rf, f.rfMin, f.rfMax)) return false;
      if (!inRange(s.pri, f.priMin, f.priMax)) return false;
      if (!inRange(s.pw, f.pwMin, f.pwMax)) return false;
      if (track && !s.tracks.includes(track)) return false;
      if (f.identified && !s.identifiedAs.some((i) => i.label.split(" / ")[0] === f.identified)) return false;
      return true;
    });
  }, [rows, filters, selected, markedPerRow]);

  useEffect(() => {
    if (jumpTo == null) return;
    const index = visible.findIndex((r) => r.group.id === jumpTo);
    if (index < 0) {
      setJumpTo(null);
      return;
    }
    const targetPage = Math.floor(index / PAGE_SIZE);
    if (page !== targetPage) {
      setPage(targetPage);
      return;
    }
    setJumpTo(null);
    window.requestAnimationFrame(() =>
      document.getElementById(`import-row-${jumpTo}`)?.scrollIntoView({ block: "center", behavior: "smooth" }),
    );
  }, [jumpTo, visible, page]);

  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = visible.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);
  const filtered = JSON.stringify(filters) !== JSON.stringify(NO_FILTERS);

  const selectedGroups = groups.filter((g) => selected.has(g.id));
  const selectedReports = selectedGroups.flatMap((g) => g.lines.map((l) => byLine.get(l)!));
  const mergeBlocked = cannotMerge(selectedReports);
  const excludedLines = useMemo(() => new Set(groups.filter((g) => g.excluded).flatMap((g) => g.lines)), [groups]);
  const strays = useMemo(() => groups.filter((g) => g.stray), [groups]);
  const gapSettings: GapSettings = {
    rfMhz: Number(gap.rfMhz) || 0,
    priUs: Number(gap.priUs) || 0,
    pwUs: Number(gap.pwUs) || 0,
    minReports: Math.max(1, Math.floor(Number(gap.minReports) || 1)),
    sameTrack: gap.sameTrack,
  };
  // What Auto group works on: the selected rows, or all of them — leaving
  // out what the user excluded, but taking strays back in.
  const inScope = (g: ReportGroup) => (selected.size === 0 || selected.has(g.id)) && (!g.excluded || !!g.stray);
  // What Auto group would make with the current settings — shown, never
  // applied, until the button is pressed. Worked out a moment after the
  // sliders stop, since a large file takes a fraction of a second.
  const [preview, setPreview] = useState<AutoGroupResult | null>(null);
  const scopeKey = selected.size > 0 ? [...selected].sort((a, b) => a - b).join(",") : "all";
  useEffect(() => {
    const handle = window.setTimeout(() => {
      const lines = new Set(groups.filter(inScope).flatMap((g) => g.lines));
      setPreview(lines.size ? autoGroup(reports.filter((r) => lines.has(r.line)), gapSettings) : null);
    }, 250);
    return () => window.clearTimeout(handle);
    // gapSettings and inScope are rebuilt each render; gap and scopeKey stand in for them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gap, scopeKey, groups, reports]);

  // Splitting at a value: how many of the selected rows have reports on both sides.
  const splitValue = splitting && splitting.value !== "" ? Number(splitting.value) : null;
  const splitResult = useMemo(
    () =>
      splitting && splitValue != null && !Number.isNaN(splitValue)
        ? splitAtValue(groups, selected, byLine, splitting.param, splitValue)
        : null,
    [splitting, splitValue, groups, selected, byLine],
  );
  // While splitting, the charts show just the selected rows' reports — where the dip between two humps shows.
  const splitLines = useMemo(
    () => (splitting ? new Set(groups.filter((g) => selected.has(g.id)).flatMap((g) => g.lines)) : null),
    [splitting, groups, selected],
  );

  const toRange = (lo: string, hi: string): Range =>
    lo === "" && hi === "" ? null : [lo === "" ? -Infinity : Number(lo), hi === "" ? Infinity : Number(hi)];
  const rangeKeys: Record<RangeParam, [keyof Filters, keyof Filters]> = {
    rf: ["rfMin", "rfMax"],
    pri: ["priMin", "priMax"],
    pw: ["pwMin", "pwMax"],
  };
  // Rounded outwards, so a dragged range never drops a value at its edge.
  const fromRange = (range: Range): [string, string] =>
    range ? [String(Math.floor(range[0] * 1000) / 1000), String(Math.ceil(range[1] * 1000) / 1000)] : ["", ""];
  function setRange(param: RangeParam, range: Range) {
    const [lo, hi] = fromRange(range);
    const [kLo, kHi] = rangeKeys[param];
    setFilters((f) => ({ ...f, [kLo]: lo, [kHi]: hi }));
    setPage(0);
  }
  /** A typed range, open-ended when only one end is given. */
  function chartRange(param: RangeParam): Range {
    const r = toRange(filters[rangeKeys[param][0]] as string, filters[rangeKeys[param][1]] as string);
    return r && !Number.isNaN(r[0]) && !Number.isNaN(r[1]) ? r : null;
  }

  const allPageSelected = pageRows.length > 0 && pageRows.every((r) => selected.has(r.group.id));

  function setFilter<K extends keyof Filters>(key: K, value: Filters[K]) {
    setFilters((f) => ({ ...f, [key]: value }));
    setPage(0);
  }
  function apply(next: ReportGroup[], note: string) {
    onChange(next);
    setSelected(new Set());
    setSplitting(null);
    setMessage(note);
  }
  function toggle(set: Set<number>, id: number, update: (s: Set<number>) => void) {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    update(next);
  }

  async function runAutoGroup() {
    const scope = groups.filter(inScope);
    const scopeLines = new Set(scope.flatMap((g) => g.lines));
    const merged = scope.filter((g) => g.lines.length > 1).length;
    if (scopeLines.size === 0) {
      setMessage("Nothing to group — every report in scope is excluded.");
      return;
    }
    if (
      merged > 0 &&
      !(await confirm(
        `Auto group regroups ${scopeLines.size} report${scopeLines.size === 1 ? "" : "s"} from scratch, replacing ${merged} group${merged === 1 ? "" : "s"} already made among them.`,
        { confirmLabel: "Regroup" },
      ))
    )
      return;
    const scopeIds = new Set(scope.map((g) => g.id));
    const result = autoGroup(
      reports.filter((r) => scopeLines.has(r.line)),
      gapSettings,
    );
    const n = result.groups.length;
    apply(
      [...groups.filter((g) => !scopeIds.has(g.id)), ...result.groups, ...result.strays],
      `Auto group put ${(scopeLines.size - result.strays.length).toLocaleString()} reports into ${n.toLocaleString()} group${n === 1 ? "" : "s"}` +
        (result.strays.length > 0
          ? ` and set ${result.strays.length.toLocaleString()} aside as strays.`
          : "."),
    );
  }

  function applySplit() {
    if (!splitting || !splitResult || splitValue == null) return;
    const label = SPLIT_LABEL[splitting.param];
    apply(
      splitResult.groups,
      `Split ${splitResult.split} row${splitResult.split === 1 ? "" : "s"} at ${label.split(" (")[0]} ${splitValue}.`,
    );
  }

  async function resetAll() {
    if (!(await confirm("Undo all grouping and exclusions — one entry per report again?", { confirmLabel: "Start over" })))
      return;
    apply(oneGroupPerReport(reports), "Back to one entry per report.");
  }

  const numberFilter = (label: string, lo: keyof Filters, hi: keyof Filters) => (
    <label className="import-filter-range">
      {label}
      <span>
        <input type="number" step="any" placeholder="min" value={filters[lo]} onChange={(e) => setFilter(lo, e.target.value)} />
        <input type="number" step="any" placeholder="max" value={filters[hi]} onChange={(e) => setFilter(hi, e.target.value)} />
      </span>
    </label>
  );

  return (
    <section className="card">
      <div className="card-header">
        <h4>{heading}</h4>
        <button type="button" className="button secondary small" onClick={() => void resetAll()}>
          Start over
        </button>
      </div>
      <p className="hint-text">
        Each row below becomes one entry: the mean of its reports, with their lowest and highest values as the
        measured range.{" "}
        {startsFrom ?? "Every report starts as its own row — nothing is grouped until you do it."} Select rows and{" "}
        <strong>Merge</strong> them, <strong>split</strong> them at a value, or use <strong>Auto group</strong> with
        your own gaps.
      </p>

      <div className="import-tools">
        <fieldset className="import-autogroup">
          <legend>Auto group</legend>
          <div className="import-tolerances">
            <GapSlider label="RF gap (MHz)" value={gap.rfMhz} min={0.01} max={500} onChange={(v) => setGap({ ...gap, rfMhz: v })} />
            <GapSlider label="PRI gap (µs)" value={gap.priUs} min={0.01} max={1000} onChange={(v) => setGap({ ...gap, priUs: v })} />
            <GapSlider label="PW gap (µs)" value={gap.pwUs} min={0.001} max={50} onChange={(v) => setGap({ ...gap, pwUs: v })} />
            <label className="tolerance-slider import-min-reports">
              Minimum reports per group
              <span>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={gap.minReports}
                  onChange={(e) => setGap({ ...gap, minReports: e.target.value })}
                />
              </span>
            </label>
            <label className="inline-label">
              <input
                type="checkbox"
                checked={gap.sameTrack}
                onChange={(e) => setGap({ ...gap, sameTrack: e.target.checked })}
              />
              Same track number only
            </label>
            <button type="button" className="button primary" onClick={() => void runAutoGroup()}>
              {selected.size > 0 ? `Auto group ${selected.size} selected` : "Auto group all"}
            </button>
          </div>
          <p className="import-preview">
            {preview ? (
              <>
                With these settings Auto group would make <strong>{preview.groups.length.toLocaleString()}</strong> group
                {preview.groups.length === 1 ? "" : "s"}
                {preview.strays.length > 0 && (
                  <>
                    {" "}
                    and set <strong>{preview.strays.length.toLocaleString()}</strong> report
                    {preview.strays.length === 1 ? "" : "s"} aside as strays
                  </>
                )}
                {selected.size > 0 ? " from the selected rows" : ""} — a preview, shown as ticks on the charts and boxes
                on the scatter. Nothing changes until you press the button.
              </>
            ) : (
              <span className="hint-text">Working out the preview…</span>
            )}
          </p>
          <p className="hint-text import-rule">
            <strong>What it does:</strong> {AUTO_GROUP_RULE} With rows selected it only regroups those.
          </p>
        </fieldset>
      </div>

      <div className="import-charts-section">
        <div className="import-charts-bar">
          <button type="button" className="link-button" aria-expanded={chartsOpen} onClick={() => setChartsOpen(!chartsOpen)}>
            {chartsOpen ? "▾ Charts" : "▸ Charts"}
          </button>
          <div className="import-chart-tabs" role="tablist" aria-label="Charts">
            {(
              [
                ["distributions", "Scatter & distributions"],
                ["time", "Over time"],
              ] as [ChartTab, string][]
            ).map(([tab, label]) => (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={chartsOpen && chartTab === tab}
                className={chartsOpen && chartTab === tab ? "sub-tab active" : "sub-tab"}
                onClick={() => setChartTab(tab)}
              >
                {label}
              </button>
            ))}
          </div>
          {chartsOpen && (
            <span className="hint-text">
              {splitting
                ? "Showing only the selected rows' reports." +
                  (chartTab === "distributions" ? " Click the RF, PRI or PW chart where you want to split them." : "")
                : chartTab === "distributions"
                  ? "Drag across a chart to filter to that range (the table below follows, and the other charts narrow to it); click a chart to clear its range."
                  : "Box the dots you want on any chart to mark them, then make a group of them."}
            </span>
          )}
        </div>
        {chartsOpen && (
          <ImportCharts
            showDistributions={chartTab === "distributions"}
            showTime={chartTab === "time"}
            onGroupLines={(lines) => {
              const result = groupReports(groups, lines, byLine);
              const n = result.made.length;
              onChange(result.groups);
              setSplitting(null);
              // The new rows are selected — so they stay lit on the charts — and brought into view in the table.
              setSelected(new Set(result.made.map((g) => g.id)));
              if (filters.show === "marked") setFilters((f) => ({ ...f, show: "selected" }));
              setJumpTo(result.made[0]?.id ?? null);
              setMessage(
                (n === 1
                  ? `Made a group of ${lines.length.toLocaleString()} marked report${lines.length === 1 ? "" : "s"}`
                  : `Made ${n} groups of the ${lines.length.toLocaleString()} marked reports — one per PRI type`) +
                  (n === 1 ? " and selected it in the table below." : " and selected them in the table below."),
              );
            }}
            selectedLines={selectedLines}
            selectedRows={selected.size}
            onClearSelection={() => setSelected(new Set())}
            onMarkedChange={setMarkedLines}
            markedRows={markedPerRow.size}
            onShowMarkedRows={() => {
              setFilter("show", "marked");
              document.querySelector(".import-filters")?.scrollIntoView({ block: "start", behavior: "smooth" });
            }}
            reports={reports}
            excludedLines={excludedLines}
            modes={modes}
            filters={{
              type: filters.type,
              track: filters.track,
              identified: filters.identified,
              rf: chartRange("rf"),
              pri: chartRange("pri"),
              pw: chartRange("pw"),
            }}
            onRange={setRange}
            onBox={(xp, xr, yp, yr) => {
              const [xLo, xHi] = fromRange(xr);
              const [yLo, yHi] = fromRange(yr);
              setFilters((f) => ({
                ...f,
                [rangeKeys[xp][0]]: xLo,
                [rangeKeys[xp][1]]: xHi,
                [rangeKeys[yp][0]]: yLo,
                [rangeKeys[yp][1]]: yHi,
              }));
              setPage(0);
            }}
            preview={preview?.groups ?? null}
            groups={groups}
            onlyLines={splitLines}
            split={splitting && splitValue != null && !Number.isNaN(splitValue) ? { param: splitting.param, value: splitValue } : null}
            onSplitPick={
              splitting
                ? (param, value) => setSplitting({ param, value: String(Number(value.toPrecision(6))) })
                : undefined
            }
          />
        )}
      </div>

      <div className="import-filters">
        <label>
          PRI type
          <select value={filters.type} onChange={(e) => setFilter("type", e.target.value as Filters["type"])}>
            <option value="">All</option>
            <option value="fixed">Fixed</option>
            <option value="stagger">Stagger</option>
            <option value="cw">CW</option>
          </select>
        </label>
        {numberFilter("RF (MHz)", "rfMin", "rfMax")}
        {numberFilter("PRI (µs)", "priMin", "priMax")}
        {numberFilter("PW (µs)", "pwMin", "pwMax")}
        <label>
          Track
          <input value={filters.track} onChange={(e) => setFilter("track", e.target.value)} placeholder="any" size={6} />
        </label>
        {identifications.length > 1 && (
          <label>
            Identified as
            <select value={filters.identified} onChange={(e) => setFilter("identified", e.target.value)}>
              <option value="">Any</option>
              {identifications.map((i) => (
                <option key={i} value={i}>
                  {i}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          Show
          <select value={filters.show} onChange={(e) => setFilter("show", e.target.value as Filters["show"])}>
            <option value="all">{strays.length > 0 ? "All but strays" : "All rows"}</option>
            <option value="included">Included</option>
            <option value="excluded">Excluded</option>
            {(strays.length > 0 || filters.show === "strays") && <option value="strays">Strays</option>}
            {(selected.size > 0 || filters.show === "selected") && <option value="selected">Selected rows</option>}
            {(markedLines.size > 0 || filters.show === "marked") && (
              <option value="marked">Rows with marked reports</option>
            )}
          </select>
        </label>
        {filtered && (
          <button type="button" className="link-button" onClick={() => setFilters(NO_FILTERS)}>
            Clear filters
          </button>
        )}
      </div>
      <p className="hint-text">Filters compare each row's mean; they only narrow what's listed and selected.</p>

      <div className="import-selection">
        <span>
          {selected.size} selected
          {visible.length > pageRows.length && !visible.every((r) => selected.has(r.group.id)) && (
            <>
              {" · "}
              <button
                type="button"
                className="link-button"
                onClick={() => setSelected(new Set(visible.map((r) => r.group.id)))}
              >
                Select all {visible.length.toLocaleString()} {filtered ? "matching rows" : "rows"}
              </button>
            </>
          )}
          {selected.size > 0 && (
            <>
              {" · "}
              <button type="button" className="link-button" onClick={() => setSelected(new Set())}>
                Clear selection
              </button>
            </>
          )}
        </span>
        <span className="import-selection-actions">
          <button
            type="button"
            className="button secondary small"
            disabled={!!mergeBlocked}
            title={mergeBlocked ?? undefined}
            onClick={() =>
              apply(
                mergeGroups(groups, selected),
                `Merged ${selectedReports.length} reports into one row.`,
              )
            }
          >
            Merge into one
          </button>
          <button
            type="button"
            className="button secondary small"
            disabled={!selectedGroups.some((g) => g.lines.length > 1)}
            onClick={() => apply(splitGroups(groups, selected), "Split back into one row per report.")}
          >
            Split
          </button>
          <button
            type="button"
            className="button secondary small"
            aria-pressed={!!splitting}
            disabled={!splitting && !selectedGroups.some((g) => g.lines.length > 1)}
            onClick={() => {
              setSplitting(splitting ? null : { param: "rf", value: "" });
              if (!splitting) setChartTab("distributions");
            }}
          >
            Split at a value…
          </button>
          <button
            type="button"
            className="button secondary small"
            disabled={!selectedGroups.some((g) => !g.excluded || g.stray)}
            onClick={() => apply(setExcluded(groups, selected, true), `Excluded ${selected.size} row(s) from the import.`)}
          >
            Exclude
          </button>
          <button
            type="button"
            className="button secondary small"
            disabled={!selectedGroups.some((g) => g.excluded)}
            onClick={() => apply(setExcluded(groups, selected, false), `Included ${selected.size} row(s) again.`)}
          >
            Include
          </button>
        </span>
      </div>
      {selected.size > 1 && mergeBlocked && <p className="hint-text">Can't merge: {mergeBlocked}</p>}
      {splitting && (
        <div className="import-split">
          <span>
            Split the {selected.size} selected row{selected.size === 1 ? "" : "s"} at
          </span>
          <select
            aria-label="Parameter to split on"
            value={splitting.param}
            onChange={(e) => setSplitting({ ...splitting, param: e.target.value as SplitParam })}
          >
            {(Object.keys(SPLIT_LABEL) as SplitParam[]).map((p) => (
              <option key={p} value={p}>
                {SPLIT_LABEL[p]}
              </option>
            ))}
          </select>
          <input
            type="number"
            step="any"
            aria-label="Value to split at"
            placeholder="click a chart"
            value={splitting.value}
            onChange={(e) => setSplitting({ ...splitting, value: e.target.value })}
          />
          <button type="button" className="button primary small" disabled={!splitResult?.split} onClick={applySplit}>
            Split
          </button>
          <button type="button" className="link-button" onClick={() => setSplitting(null)}>
            Cancel
          </button>
          <span className="hint-text">
            {splitResult
              ? splitResult.split > 0
                ? `Reports at or below the value go in one row, those above in another — ${splitResult.split} row${splitResult.split === 1 ? "" : "s"} would split.`
                : "None of the selected rows have reports on both sides of that value."
              : "Click the RF, PRI or PW chart above at the dip between two humps, or type the value."}
          </span>
        </div>
      )}
      {strays.length > 0 && (
        <div className="import-strays">
          <span>
            <strong>
              {strays.length.toLocaleString()} stray{strays.length === 1 ? "" : "s"}
            </strong>{" "}
            — reports Auto group set aside (too few others near them). They&apos;re held out of the import until you
            decide: select them with a group and <strong>Merge</strong>, or
          </span>
          <span className="import-selection-actions">
            {filters.show !== "strays" ? (
              <button type="button" className="button secondary small" onClick={() => setFilter("show", "strays")}>
                Show them
              </button>
            ) : (
              <button type="button" className="button secondary small" onClick={() => setFilter("show", "all")}>
                Back to the groups
              </button>
            )}
            <button
              type="button"
              className="button secondary small"
              onClick={() =>
                apply(
                  setExcluded(groups, new Set(strays.map((g) => g.id)), false),
                  `Kept ${strays.length.toLocaleString()} strays, each as its own entry.`,
                )
              }
            >
              Keep each as its own entry
            </button>
            <button
              type="button"
              className="button secondary small"
              onClick={() =>
                apply(
                  setExcluded(groups, new Set(strays.map((g) => g.id)), true),
                  `Excluded ${strays.length.toLocaleString()} strays from the import.`,
                )
              }
            >
              Exclude them
            </button>
          </span>
        </div>
      )}
      {message && <p className="import-message">{message}</p>}

      <div className="import-table-wrap">
        <table className="data-table import-groups">
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  aria-label="Select this page"
                  checked={allPageSelected}
                  onChange={() => {
                    const next = new Set(selected);
                    for (const r of pageRows) {
                      if (allPageSelected) next.delete(r.group.id);
                      else next.add(r.group.id);
                    }
                    setSelected(next);
                  }}
                />
              </th>
              <th>Reports</th>
              <th>PRI type</th>
              <th>RF (MHz)</th>
              <th>PRI (µs)</th>
              <th>PW (µs)</th>
              <th>Jitter / stagger (µs)</th>
              <th>Track</th>
              <th>Identified as</th>
              <th>Time</th>
              {modes && <th>Match</th>}
            </tr>
          </thead>
          <tbody>
            {pageRows.map(({ group, summary: s }) => {
              const single = s.count === 1;
              const open = expanded.has(group.id);
              const match = modes
                ? matchEntry(
                    {
                      pri_type: s.priType,
                      rf_mean_mhz: s.rf.mean,
                      pri_mean_us: s.pri?.mean ?? null,
                      pw_mean_us: s.pw?.mean ?? null,
                      stagger_values: s.stagger,
                    },
                    modes,
                  )
                : null;
              return (
                <Fragment key={group.id}>
                  <tr
                    id={`import-row-${group.id}`}
                    className={
                      [group.excluded && "import-excluded", markedPerRow.has(group.id) && "import-row-marked"]
                        .filter(Boolean)
                        .join(" ") || undefined
                    }
                  >
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`Select row with line ${fileLine(group.id)}`}
                        checked={selected.has(group.id)}
                        onChange={() => toggle(selected, group.id, setSelected)}
                      />
                    </td>
                    <td>
                      {single ? (
                        <span className="hint-text">line {fileLine(group.lines[0])}</span>
                      ) : (
                        <button
                          type="button"
                          className="link-button"
                          aria-expanded={open}
                          onClick={() => toggle(expanded, group.id, setExpanded)}
                        >
                          {open ? "▾" : "▸"} {s.count} reports
                        </button>
                      )}
                      {group.stray ? (
                        <div className="match-badge import-excluded-tag">Stray</div>
                      ) : (
                        group.excluded && <div className="match-badge import-excluded-tag">Excluded</div>
                      )}
                      {markedPerRow.has(group.id) && (
                        <div className="match-badge import-marked-tag" title="Reports marked on the Over time charts">
                          {markedPerRow.get(group.id) === s.count
                            ? "Marked"
                            : `${markedPerRow.get(group.id)!.toLocaleString()} marked`}
                        </div>
                      )}
                    </td>
                    <td>
                      {TYPE_LABEL[s.priType]}
                      {s.stagger && (
                        <div className="hint-text cell-subline">
                          {s.stagger.length} position{s.stagger.length === 1 ? "" : "s"}
                        </div>
                      )}
                    </td>
                    <td>
                      <Value m={s.rf} single={single} />
                    </td>
                    <td>
                      <Value m={s.pri} single={single} />
                      {s.priType === "stagger" && <div className="hint-text cell-subline">frame time</div>}
                    </td>
                    <td>
                      <Value m={s.pw} single={single} />
                    </td>
                    <td>
                      {s.priType === "fixed" ? (
                        <Value m={s.jitter} single={single} />
                      ) : s.stagger ? (
                        s.stagger.join(", ")
                      ) : (
                        <span className="hint-text">—</span>
                      )}
                    </td>
                    <td>
                      {s.tracks.length <= 3 ? s.tracks.join(", ") || "—" : `${s.tracks.slice(0, 3).join(", ")} +${s.tracks.length - 3}`}
                    </td>
                    <td>
                      {s.identifiedAs.map((i) => (
                        <div key={i.label}>
                          {i.label}
                          {s.identifiedAs.length > 1 && <span className="hint-text"> ({i.count})</span>}
                        </div>
                      ))}
                    </td>
                    <td className="hint-text">
                      {formatMissionTime(s.firstTime)}
                      {s.lastTime && s.lastTime !== s.firstTime && <div>– {formatMissionTime(s.lastTime)}</div>}
                    </td>
                    {modes && <td>{match && <EntryMatchCell match={match} emitterId={emitterId} compact />}</td>}
                  </tr>
                  {open && (
                    <tr className="import-group-reports">
                      <td colSpan={modes ? 11 : 10}>
                        <table className="data-table">
                          <thead>
                            <tr>
                              <th>Line</th>
                              <th>Time</th>
                              <th>Track</th>
                              <th>RF (MHz)</th>
                              <th>PRI (µs)</th>
                              <th>PW (µs)</th>
                              <th>Jitter / stagger (µs)</th>
                              <th>Power (dBm)</th>
                              <th />
                            </tr>
                          </thead>
                          <tbody>
                            {group.lines.slice(0, REPORTS_SHOWN).map((line) => {
                              const r = byLine.get(line)!;
                              return (
                                <tr key={line}>
                                  <td>{fileLine(line)}</td>
                                  <td>{formatMissionTime(r.missionTime)}</td>
                                  <td>{r.track ?? "—"}</td>
                                  <td>{r.rfMhz}</td>
                                  <td>{r.priUs ?? "—"}</td>
                                  <td>{r.pwUs ?? "—"}</td>
                                  <td>{r.priType === "fixed" ? (r.jitterUs ?? "—") : (r.staggerUs?.join(", ") ?? "—")}</td>
                                  <td>{r.power ?? "—"}</td>
                                  <td>
                                    <button
                                      type="button"
                                      className="link-button"
                                      onClick={() => apply(takeOut(groups, group.id, line), `Line ${fileLine(line)} is its own row again.`)}
                                    >
                                      Take out
                                    </button>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                        {group.lines.length > REPORTS_SHOWN && (
                          <p className="hint-text">
                            Showing the first {REPORTS_SHOWN} of {group.lines.length} reports.
                          </p>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {visible.length === 0 && <p className="hint-text">No rows match the filters.</p>}
      {pageCount > 1 && (
        <div className="list-pager">
          <button type="button" className="button secondary small" disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>
            ← Previous
          </button>
          <span>
            Rows {(safePage * PAGE_SIZE + 1).toLocaleString()}–{Math.min((safePage + 1) * PAGE_SIZE, visible.length).toLocaleString()} of{" "}
            {visible.length.toLocaleString()}
          </span>
          <button
            type="button"
            className="button secondary small"
            disabled={safePage >= pageCount - 1}
            onClick={() => setPage(safePage + 1)}
          >
            Next →
          </button>
        </div>
      )}
      {dialog}
    </section>
  );
}
