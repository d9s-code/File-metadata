import { useEffect, useMemo, useState } from "react";
import type { CsvReport, ReportPriType } from "./interceptCsv";
import { formatMissionTime } from "./interceptCsv";
import type { GroupSummary, Measured, ReportGroup } from "./interceptGroups";
import { describeMiss, matchEntry, type EntryMatch } from "./interceptMatch";
import { EntryMatchCell } from "./EntryMatchCell";
import type { Mode } from "../../types/domain";

const PAGE_SIZE = 100;
const TYPE_LABEL: Record<ReportPriType, string> = { fixed: "Fixed", stagger: "Stagger", cw: "CW" };

/** Why a report falls outside every Mode — what to look at to cover it. */
type Reason = "RF" | "PRI" | "PW" | "several" | "no-modes";
const REASONS: Reason[] = ["RF", "PRI", "PW", "several", "no-modes"];
const REASON_LABEL: Record<Reason, string> = {
  RF: "RF off",
  PRI: "PRI / frame time off",
  PW: "PW off",
  several: "Off on two or more",
  "no-modes": "No Mode of its PRI type",
};
const REASON_HINT: Record<Reason, string> = {
  RF: "Inside a Mode on PRI and PW, outside it on RF",
  PRI: "Inside a Mode on RF and PW, outside it on PRI — the frame time for a stagger, or a different number of stagger positions",
  PW: "Inside a Mode on RF and PRI, outside it on PW",
  several: "Outside every Mode of its PRI type on two or more of RF, PRI and PW (for CW, which is compared on RF only: outside every CW Mode)",
  "no-modes": "The Emitter has no Mode of this PRI type to compare with",
};

export interface UncoveredRow {
  group: ReportGroup;
  summary: GroupSummary;
}

interface Outside {
  report: CsvReport;
  group: ReportGroup;
  reason: Reason;
  /** The nearest Mode and how far off, for a one-parameter miss. */
  detail: string;
}

interface RowInfo extends UncoveredRow {
  match: EntryMatch;
  outside: number;
}

type Scope = "included" | "all";
type Tab = "reports" | "rows";
type RowShow = "any" | "unmatched" | "partly";
type ReportSort = "line" | "time" | "rf";

function Value({ m }: { m: Measured | null }) {
  if (m == null) return <span className="hint-text">—</span>;
  return (
    <>
      <strong>{m.mean}</strong>
      {m.min !== m.max && (
        <div className="hint-text cell-subline">
          {m.min}–{m.max}
        </div>
      )}
    </>
  );
}
const cell = (v: number | null) => (v == null ? <span className="hint-text">—</span> : v);
const plural = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/** Everything on the grouping page that the Emitter's Modes don't cover, in a
 * window of its own: each report that falls outside every Mode (and why), and
 * the rows that don't match a Mode or hold such reports. It only lists —
 * nothing changes until "Select … in the table" hands rows back to the table. */
export function UncoveredWindow({
  rows,
  reports,
  modes,
  emitterId,
  fileLine,
  onSelectRows,
  onClose,
}: {
  /** The table's rows, with their summaries. */
  rows: UncoveredRow[];
  reports: CsvReport[];
  modes: Mode[];
  emitterId: string;
  fileLine: (line: number) => string;
  /** Select these rows in the table and list just them. */
  onSelectRows: (ids: number[]) => void;
  onClose: () => void;
}) {
  const [scope, setScope] = useState<Scope>("included");
  const [tab, setTab] = useState<Tab>("reports");
  const [reason, setReason] = useState<Reason | "">("");
  const [type, setType] = useState<ReportPriType | "">("");
  const [sort, setSort] = useState<ReportSort>("line");
  const [rowShow, setRowShow] = useState<RowShow>("any");
  const [page, setPage] = useState(0);
  const [checked, setChecked] = useState<Set<number>>(new Set());

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const modeTypes = useMemo(() => new Set(modes.filter((m) => m.line).map((m) => m.pri_type)), [modes]);

  // Every report in scope that falls outside every Mode — the Match column's test, one report at a time.
  const { outside, inScope, rowInfo } = useMemo(() => {
    const byLine = new Map(reports.map((r) => [r.line, r]));
    const scoped = rows.filter((r) => scope === "all" || !r.group.excluded);
    const out: Outside[] = [];
    const perGroup = new Map<number, number>();
    let count = 0;
    for (const { group } of scoped) {
      for (const line of group.lines) {
        const r = byLine.get(line);
        if (!r) continue;
        count++;
        if (!modeTypes.has(r.priType)) {
          out.push({ report: r, group, reason: "no-modes", detail: `No ${TYPE_LABEL[r.priType]} Mode` });
          perGroup.set(group.id, (perGroup.get(group.id) ?? 0) + 1);
          continue;
        }
        const m = matchEntry(
          { pri_type: r.priType, rf_mean_mhz: r.rfMhz, pri_mean_us: r.priUs, pw_mean_us: r.pwUs, stagger_values: r.staggerUs },
          modes,
        );
        if (m.status === "match") continue;
        perGroup.set(group.id, (perGroup.get(group.id) ?? 0) + 1);
        if (m.status === "near") {
          const first = m.near[0];
          const miss = first.misses[0];
          out.push({
            report: r,
            group,
            reason: miss.param,
            detail: `${first.mode.name}: ${describeMiss(miss)}${m.near.length > 1 ? ` (+${m.near.length - 1} more)` : ""}`,
          });
        } else out.push({ report: r, group, reason: "several", detail: `Outside every ${TYPE_LABEL[r.priType]} Mode` });
      }
    }
    const info: RowInfo[] = [];
    for (const row of scoped) {
      const match = matchEntry(
        {
          pri_type: row.summary.priType,
          rf_mean_mhz: row.summary.rf.mean,
          pri_mean_us: row.summary.pri?.mean ?? null,
          pw_mean_us: row.summary.pw?.mean ?? null,
          stagger_values: row.summary.stagger,
        },
        modes,
      );
      const n = perGroup.get(row.group.id) ?? 0;
      if (match.status !== "match" || n > 0) info.push({ ...row, match, outside: n });
    }
    return { outside: out, inScope: count, rowInfo: info };
  }, [rows, reports, modes, modeTypes, scope]);

  const reasonCounts = useMemo(() => {
    const c: Record<Reason, number> = { RF: 0, PRI: 0, PW: 0, several: 0, "no-modes": 0 };
    for (const o of outside) if (!type || o.report.priType === type) c[o.reason]++;
    return c;
  }, [outside, type]);

  const listedReports = useMemo(() => {
    const list = outside.filter((o) => (!type || o.report.priType === type) && (!reason || o.reason === reason));
    const key = (o: Outside) =>
      sort === "rf" ? o.report.rfMhz : sort === "time" ? (o.report.missionTime ?? "") : o.report.line;
    return list.sort((a, b) => {
      const ka = key(a);
      const kb = key(b);
      return ka < kb ? -1 : ka > kb ? 1 : a.report.line - b.report.line;
    });
  }, [outside, type, reason, sort]);

  const unmatchedRows = rowInfo.filter((r) => r.match.status !== "match").length;
  const partlyRows = rowInfo.length - unmatchedRows;
  const listedRows = rowInfo.filter(
    (r) =>
      (!type || r.summary.priType === type) &&
      (rowShow === "any" || (rowShow === "unmatched" ? r.match.status !== "match" : r.match.status === "match")),
  );

  const list = tab === "reports" ? listedReports : listedRows;
  const pageCount = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const from = safePage * PAGE_SIZE;
  const to = Math.min(from + PAGE_SIZE, list.length);

  // Where the listed reports reach — a start for a Mode's ranges.
  const spans = useMemo(() => {
    const out: { label: string; lo: number; hi: number; unit: string }[] = [];
    const add = (label: string, unit: string, values: (number | null)[]) => {
      let lo = Infinity;
      let hi = -Infinity;
      for (const v of values) {
        if (v == null) continue;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      if (Number.isFinite(lo)) out.push({ label, lo, hi, unit });
    };
    const rs = listedReports.map((o) => o.report);
    add("RF", "MHz", rs.map((r) => r.rfMhz));
    add("PRI", "µs", rs.map((r) => (r.priType === "fixed" ? r.priUs : null)));
    add("Frame time", "µs", rs.map((r) => (r.priType === "stagger" ? r.priUs : null)));
    add("PW", "µs", rs.map((r) => r.pwUs));
    return out;
  }, [listedReports]);

  // The rows the listed reports sit in — what "Select their rows" hands back.
  const rowsOfListed = useMemo(() => [...new Set(listedReports.map((o) => o.group.id))], [listedReports]);
  const checkedListed = listedRows.filter((r) => checked.has(r.group.id));

  function reset<T>(set: (v: T) => void) {
    return (v: T) => {
      set(v);
      setPage(0);
    };
  }

  const rowLabel = (g: ReportGroup) =>
    g.lines.length === 1 ? "On its own" : `In a row of ${g.lines.length.toLocaleString()}`;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="source-overlay uncovered-window"
        role="dialog"
        aria-modal="true"
        aria-label="Not covered by the Modes"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="source-overlay-header">
          <div className="source-overlay-title">
            <h3>Not covered by the Modes</h3>
            <div className="hint-text">
              Compared with the Emitter&apos;s {plural(modes.length, "Mode", "Modes")} the same way as the Match
              column: RF, PRI (frame time for a stagger) and PW inside a Mode&apos;s engineered range, against Modes
              of the same PRI type only. Each report is compared on its own. Nothing here changes the grouping.
            </div>
          </div>
          <div className="source-overlay-nav">
            <button type="button" className="link-button" aria-label="Close" onClick={onClose}>
              ✕
            </button>
          </div>
        </div>

        <div className="uncovered-summary">
          <p>
            <strong>{outside.length.toLocaleString()}</strong> of {plural(inScope, "report", "reports")}{" "}
            {scope === "included" ? "in the included rows" : "(excluded rows too)"} fall outside every Mode
            {inScope > 0 && <span className="hint-text"> — {((outside.length / inScope) * 100).toFixed(1)}%</span>}.{" "}
            {plural(unmatchedRows, "row doesn't", "rows don't")} match a Mode as a whole
            {partlyRows > 0 && <> and {plural(partlyRows, "row matches", "rows match")} but holds reports outside</>}.
          </p>
          <div className="uncovered-controls">
            <label className="inline-label">
              Rows
              <select value={scope} onChange={(e) => reset(setScope)(e.target.value as Scope)}>
                <option value="included">Included rows</option>
                <option value="all">All rows, excluded too</option>
              </select>
            </label>
            <label className="inline-label">
              PRI type
              <select value={type} onChange={(e) => reset(setType)(e.target.value as ReportPriType | "")}>
                <option value="">All</option>
                <option value="fixed">Fixed</option>
                <option value="stagger">Stagger</option>
                <option value="cw">CW</option>
              </select>
            </label>
          </div>
        </div>

        <div className="sub-tab-bar source-overlay-tabs" role="tablist" aria-label="What to list">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "reports"}
            className={tab === "reports" ? "sub-tab active" : "sub-tab"}
            onClick={() => reset(setTab)("reports")}
          >
            Reports <span className="section-count">{listedReports.length.toLocaleString()}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "rows"}
            className={tab === "rows" ? "sub-tab active" : "sub-tab"}
            onClick={() => reset(setTab)("rows")}
          >
            Rows <span className="section-count">{listedRows.length.toLocaleString()}</span>
          </button>
        </div>

        <div className="source-overlay-body">
          {tab === "reports" ? (
            <>
              <div className="uncovered-reasons" role="group" aria-label="Why they're outside">
                <button
                  type="button"
                  className={reason === "" ? "uncovered-reason active" : "uncovered-reason"}
                  aria-pressed={reason === ""}
                  onClick={() => reset(setReason)("")}
                >
                  All <strong>{REASONS.reduce((n, k) => n + reasonCounts[k], 0).toLocaleString()}</strong>
                </button>
                {REASONS.filter((k) => reasonCounts[k] > 0 || reason === k).map((k) => (
                  <button
                    key={k}
                    type="button"
                    title={REASON_HINT[k]}
                    className={reason === k ? "uncovered-reason active" : "uncovered-reason"}
                    aria-pressed={reason === k}
                    onClick={() => reset(setReason)(k)}
                  >
                    {REASON_LABEL[k]} <strong>{reasonCounts[k].toLocaleString()}</strong>
                  </button>
                ))}
              </div>
              <p className="hint-text">
                A report off on one parameter names the nearest Mode and by how much — usually the quickest to
                cover, by widening that Mode or adding one beside it. Hover a reason for what it means.
              </p>
              {listedReports.length === 0 ? (
                <p className="hint-text">
                  {outside.length === 0 ? "Every report in scope falls inside a Mode." : "None with these filters."}
                </p>
              ) : (
                <>
                  <p className="uncovered-spans">
                    The {plural(listedReports.length, "report", "reports")} listed reach{" "}
                    {spans.map((sp, i) => (
                      <span key={sp.label}>
                        {i > 0 && " · "}
                        {sp.label} <strong>{sp.lo}</strong>–<strong>{sp.hi}</strong> {sp.unit}
                      </span>
                    ))}
                  </p>
                  <div className="uncovered-actions">
                    <label className="inline-label">
                      Sort by
                      <select value={sort} onChange={(e) => reset(setSort)(e.target.value as ReportSort)}>
                        <option value="line">Line</option>
                        <option value="time">Time</option>
                        <option value="rf">RF</option>
                      </select>
                    </label>
                    <button
                      type="button"
                      className="button primary small"
                      onClick={() => onSelectRows(rowsOfListed)}
                      title="Selects them in the table and lists only them; this window closes"
                    >
                      Select their {plural(rowsOfListed.length, "row", "rows")} in the table
                    </button>
                  </div>
                  <div className="matrix-scroll">
                    <table className="data-table compact-table">
                      <thead>
                        <tr>
                          <th>Line</th>
                          <th>Time</th>
                          <th>PRI type</th>
                          <th>RF (MHz)</th>
                          <th>PRI (µs)</th>
                          <th>PW (µs)</th>
                          <th>Why it&apos;s outside</th>
                          <th>Row</th>
                        </tr>
                      </thead>
                      <tbody>
                        {listedReports.slice(from, to).map(({ report: r, group, reason: why, detail }) => (
                          <tr key={r.line} className={group.excluded ? "import-excluded" : undefined}>
                            <td className="cell-nowrap">{fileLine(r.line)}</td>
                            <td className="cell-nowrap">{formatMissionTime(r.missionTime)}</td>
                            <td>{TYPE_LABEL[r.priType]}</td>
                            <td>{r.rfMhz}</td>
                            <td>
                              {cell(r.priUs)}
                              {r.priType === "stagger" && r.priUs != null && <span className="hint-text"> frame</span>}
                            </td>
                            <td>{cell(r.pwUs)}</td>
                            <td>
                              <span className="match-badge match-none" title={REASON_HINT[why]}>
                                {REASON_LABEL[why]}
                              </span>{" "}
                              <span className="hint-text">{detail}</span>
                            </td>
                            <td className="cell-nowrap">
                              <button
                                type="button"
                                className="link-button"
                                title="Select this report's row in the table; this window closes"
                                onClick={() => onSelectRows([group.id])}
                              >
                                {rowLabel(group)}
                              </button>
                              {group.excluded && <span className="hint-text"> · excluded</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </>
          ) : (
            <>
              <div className="uncovered-actions">
                <label className="inline-label">
                  Show
                  <select value={rowShow} onChange={(e) => reset(setRowShow)(e.target.value as RowShow)}>
                    <option value="any">Both kinds ({rowInfo.length.toLocaleString()})</option>
                    <option value="unmatched">Don&apos;t match a Mode ({unmatchedRows.toLocaleString()})</option>
                    <option value="partly">Match, but hold reports outside ({partlyRows.toLocaleString()})</option>
                  </select>
                </label>
                <button
                  type="button"
                  className="button primary small"
                  disabled={listedRows.length === 0}
                  onClick={() =>
                    onSelectRows((checkedListed.length > 0 ? checkedListed : listedRows).map((r) => r.group.id))
                  }
                  title="Selects them in the table and lists only them; this window closes"
                >
                  {checkedListed.length > 0
                    ? `Select the ${plural(checkedListed.length, "ticked row", "ticked rows")} in the table`
                    : `Select ${listedRows.length === 1 ? "this row" : `all ${listedRows.length.toLocaleString()}`} in the table`}
                </button>
              </div>
              <p className="hint-text">
                A row is matched on its means, like the Match column — so a row can match while some of its reports
                fall outside.
              </p>
              {listedRows.length === 0 ? (
                <p className="hint-text">No rows with these filters.</p>
              ) : (
                <div className="matrix-scroll">
                  <table className="data-table compact-table">
                    <thead>
                      <tr>
                        <th>
                          <input
                            type="checkbox"
                            aria-label="Tick every row listed"
                            checked={checkedListed.length === listedRows.length}
                            onChange={(e) =>
                              setChecked(e.target.checked ? new Set(listedRows.map((r) => r.group.id)) : new Set())
                            }
                          />
                        </th>
                        <th>PRI type</th>
                        <th>RF (MHz)</th>
                        <th>PRI (µs)</th>
                        <th>PW (µs)</th>
                        <th>Reports outside</th>
                        <th>Row matches</th>
                      </tr>
                    </thead>
                    <tbody>
                      {listedRows.slice(from, to).map(({ group, summary: s, match, outside: n }) => (
                        <tr key={group.id} className={group.excluded ? "import-excluded" : undefined}>
                          <td>
                            <input
                              type="checkbox"
                              aria-label="Tick this row"
                              checked={checked.has(group.id)}
                              onChange={() => {
                                const next = new Set(checked);
                                if (next.has(group.id)) next.delete(group.id);
                                else next.add(group.id);
                                setChecked(next);
                              }}
                            />
                          </td>
                          <td>
                            {TYPE_LABEL[s.priType]}
                            {group.excluded && <span className="hint-text"> · excluded</span>}
                          </td>
                          <td>
                            <Value m={s.rf} />
                          </td>
                          <td>
                            <Value m={s.pri} />
                          </td>
                          <td>
                            <Value m={s.pw} />
                          </td>
                          <td>
                            <strong>{n.toLocaleString()}</strong>
                            <span className="hint-text"> of {s.count.toLocaleString()}</span>
                          </td>
                          <td>
                            <EntryMatchCell match={match} emitterId={emitterId} compact />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
          {list.length > PAGE_SIZE && (
            <div className="list-pager">
              <button type="button" className="button secondary small" disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>
                ← Previous
              </button>
              <span>
                {from + 1}–{to} of {list.length.toLocaleString()}
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
        </div>
      </div>
    </div>
  );
}
