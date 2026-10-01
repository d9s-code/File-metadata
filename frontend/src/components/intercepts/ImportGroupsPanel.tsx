import { Fragment, useEffect, useMemo, useState } from "react";
import type { CsvReport, ReportPriType } from "./interceptCsv";
import { formatMissionTime } from "./interceptCsv";
import {
  AUTO_GROUP_RULE,
  autoGroup,
  cannotMerge,
  mergeGroups,
  oneGroupPerReport,
  setExcluded,
  splitGroups,
  summarize,
  takeOut,
  type GroupSummary,
  type Measured,
  type ReportGroup,
  type Tolerances,
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
  show: "all" | "included" | "excluded";
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

/** A tolerance slider: logarithmic, so the small values that matter get most
 * of its travel; far left is 0. The number beside it takes any value. */
const SLIDER_STEPS = 1000;
function ToleranceSlider({
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
 * user does the grouping — by selecting rows and merging them, or with Auto
 * group and tolerances they set; nothing regroups on its own. */
export function ImportGroupsPanel({
  reports,
  groups,
  onChange,
  modes,
  emitterId,
}: {
  reports: CsvReport[];
  groups: ReportGroup[];
  onChange: (groups: ReportGroup[]) => void;
  modes: Mode[] | undefined;
  emitterId: string;
}) {
  const byLine = useMemo(() => new Map(reports.map((r) => [r.line, r])), [reports]);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [tol, setTol] = useState({ rfMhz: "1", priUs: "1", pwUs: "0.1", sameTrack: false });
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [page, setPage] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const { confirmDelete: confirm, dialog } = useConfirmDialog();
  const [chartsOpen, setChartsOpenState] = useState(() => {
    try {
      return localStorage.getItem(CHARTS_OPEN_KEY) !== "false";
    } catch {
      return true;
    }
  });
  function setChartsOpen(open: boolean) {
    setChartsOpenState(open);
    try {
      localStorage.setItem(CHARTS_OPEN_KEY, String(open));
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

  const visible = useMemo(() => {
    const f = filters;
    const track = f.track.trim();
    return rows.filter(({ group, summary: s }) => {
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
  }, [rows, filters]);

  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = visible.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);
  const filtered = JSON.stringify(filters) !== JSON.stringify(NO_FILTERS);

  const selectedGroups = groups.filter((g) => selected.has(g.id));
  const selectedReports = selectedGroups.flatMap((g) => g.lines.map((l) => byLine.get(l)!));
  const mergeBlocked = cannotMerge(selectedReports);
  const excludedLines = useMemo(() => new Set(groups.filter((g) => g.excluded).flatMap((g) => g.lines)), [groups]);
  const tolerances: Tolerances = {
    rfMhz: Number(tol.rfMhz) || 0,
    priUs: Number(tol.priUs) || 0,
    pwUs: Number(tol.pwUs) || 0,
    sameTrack: tol.sameTrack,
  };
  // What Auto group would make with the current tolerances — shown, never
  // applied, until the button is pressed. Worked out a moment after the
  // sliders stop, since a large file takes a fraction of a second.
  const [preview, setPreview] = useState<ReportGroup[] | null>(null);
  const scopeKey = selected.size > 0 ? [...selected].sort((a, b) => a - b).join(",") : "all";
  useEffect(() => {
    const handle = window.setTimeout(() => {
      const scope = (selected.size > 0 ? groups.filter((g) => selected.has(g.id)) : groups).filter((g) => !g.excluded);
      const lines = new Set(scope.flatMap((g) => g.lines));
      setPreview(lines.size ? autoGroup(reports.filter((r) => lines.has(r.line)), [], tolerances) : null);
    }, 250);
    return () => window.clearTimeout(handle);
    // tolerances is rebuilt from tol each render; scopeKey stands in for the selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tol, scopeKey, groups, reports]);

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
    setMessage(note);
  }
  function toggle(set: Set<number>, id: number, update: (s: Set<number>) => void) {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    update(next);
  }

  async function runAutoGroup() {
    const scope = (selected.size > 0 ? selectedGroups : groups).filter((g) => !g.excluded);
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
    const regrouped = autoGroup(
      reports.filter((r) => scopeLines.has(r.line)),
      [],
      tolerances,
    );
    apply(
      [...groups.filter((g) => !scopeIds.has(g.id)), ...regrouped],
      `Auto group put ${scopeLines.size} reports into ${regrouped.length} group${regrouped.length === 1 ? "" : "s"}.`,
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
        <h4>3. Group reports into entries</h4>
        <button type="button" className="button secondary small" onClick={() => void resetAll()}>
          Start over
        </button>
      </div>
      <p className="hint-text">
        Each row below becomes one entry: the mean of its reports, with their lowest and highest values as the
        measured range. Every report starts as its own row — nothing is grouped until you do it. Select rows and{" "}
        <strong>Merge</strong> them, or use <strong>Auto group</strong> with your own tolerances.
      </p>

      <div className="import-tools">
        <fieldset className="import-autogroup">
          <legend>Auto group</legend>
          <div className="import-tolerances">
            <ToleranceSlider label="RF ± (MHz)" value={tol.rfMhz} min={0.01} max={500} onChange={(v) => setTol({ ...tol, rfMhz: v })} />
            <ToleranceSlider label="PRI ± (µs)" value={tol.priUs} min={0.01} max={1000} onChange={(v) => setTol({ ...tol, priUs: v })} />
            <ToleranceSlider label="PW ± (µs)" value={tol.pwUs} min={0.001} max={50} onChange={(v) => setTol({ ...tol, pwUs: v })} />
            <label className="inline-label">
              <input
                type="checkbox"
                checked={tol.sameTrack}
                onChange={(e) => setTol({ ...tol, sameTrack: e.target.checked })}
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
                With these tolerances Auto group would make <strong>{preview.length.toLocaleString()}</strong> group
                {preview.length === 1 ? "" : "s"}
                {selected.size > 0 ? " from the selected rows" : ""} — a preview, shown as ticks on the charts. Nothing
                changes until you press the button.
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
        <button type="button" className="link-button" aria-expanded={chartsOpen} onClick={() => setChartsOpen(!chartsOpen)}>
          {chartsOpen ? "▾ Charts" : "▸ Charts"}
        </button>
        <span className="hint-text">
          {" "}
          Drag across a chart to filter to that range (the table below follows, and the other charts narrow to it);
          click a chart to clear its range.
        </span>
        {chartsOpen && (
          <ImportCharts
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
            onBox={(rf, pri) => {
              const [rLo, rHi] = fromRange(rf);
              const [pLo, pHi] = fromRange(pri);
              setFilters((f) => ({ ...f, rfMin: rLo, rfMax: rHi, priMin: pLo, priMax: pHi }));
              setPage(0);
            }}
            preview={preview}
          />
        )}
      </div>

      <div className="import-filters">
        <label>
          Type
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
            <option value="all">All rows</option>
            <option value="included">Included</option>
            <option value="excluded">Excluded</option>
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
            disabled={!selectedGroups.some((g) => !g.excluded)}
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
              <th>Type</th>
              <th>RF (MHz)</th>
              <th>PRI (µs)</th>
              <th>Jitter / stagger (µs)</th>
              <th>PW (µs)</th>
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
                  <tr className={group.excluded ? "import-excluded" : undefined}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`Select row with line ${group.id}`}
                        checked={selected.has(group.id)}
                        onChange={() => toggle(selected, group.id, setSelected)}
                      />
                    </td>
                    <td>
                      {single ? (
                        <span className="hint-text">line {group.lines[0]}</span>
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
                      {group.excluded && <div className="match-badge import-excluded-tag">Excluded</div>}
                    </td>
                    <td>{TYPE_LABEL[s.priType]}</td>
                    <td>
                      <Value m={s.rf} single={single} />
                    </td>
                    <td>
                      <Value m={s.pri} single={single} />
                      {s.priType === "stagger" && <div className="hint-text cell-subline">frame time</div>}
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
                      <Value m={s.pw} single={single} />
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
                    {modes && <td>{match && <EntryMatchCell match={match} emitterId={emitterId} />}</td>}
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
                              <th>Jitter / stagger (µs)</th>
                              <th>PW (µs)</th>
                              <th>Power (dBm)</th>
                              <th />
                            </tr>
                          </thead>
                          <tbody>
                            {group.lines.slice(0, REPORTS_SHOWN).map((line) => {
                              const r = byLine.get(line)!;
                              return (
                                <tr key={line}>
                                  <td>{line}</td>
                                  <td>{formatMissionTime(r.missionTime)}</td>
                                  <td>{r.track ?? "—"}</td>
                                  <td>{r.rfMhz}</td>
                                  <td>{r.priUs ?? "—"}</td>
                                  <td>{r.priType === "fixed" ? (r.jitterUs ?? "—") : (r.staggerUs?.join(", ") ?? "—")}</td>
                                  <td>{r.pwUs ?? "—"}</td>
                                  <td>{r.power ?? "—"}</td>
                                  <td>
                                    <button
                                      type="button"
                                      className="link-button"
                                      onClick={() => apply(takeOut(groups, group.id, line), `Line ${line} is its own row again.`)}
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
