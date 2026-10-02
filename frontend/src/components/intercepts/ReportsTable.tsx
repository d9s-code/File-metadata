import { useState } from "react";
import { useInterceptReports } from "../../state/hooks/useIntercepts";
import type { ReportSort } from "../../api/intercepts";
import type { InterceptReport } from "../../types/domain";

const PRI_TYPE_LABEL: Record<string, string> = { fixed: "Fixed", stagger: "Stagger", cw: "CW" };

const pad = (n: number, w = 2) => String(n).padStart(w, "0");
/** A mission time as written in the file (stored as UTC), to the millisecond. */
function missionTime(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}.${pad(d.getUTCMilliseconds(), 3)}`
  );
}

const dash = <span className="hint-text">—</span>;

/** An Intercept's reports — the single measurements its entries were built
 * from — a page at a time from the server, sortable by clicking a heading.
 * Shows one entry's reports, those in no entry, or all of them. */
export function ReportsTable({
  interceptId,
  entryId,
  entryLabel,
  showFile,
  pageSize = 50,
}: {
  interceptId: string;
  /** An entry's id, "none" for reports in no entry, or undefined for all. */
  entryId?: string | "none";
  /** For the Entry column (shown when listing more than one entry's reports). */
  entryLabel?: (entryId: string | null) => string;
  /** Show which file each report came from — when the Intercept holds several. */
  showFile?: boolean;
  pageSize?: number;
}) {
  const [sort, setSort] = useState<ReportSort>("line");
  const [direction, setDirection] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(0);
  const { data, isLoading, isFetching, error } = useInterceptReports(interceptId, {
    entryId,
    sort,
    direction,
    offset: page * pageSize,
    limit: pageSize,
  });

  function sortBy(key: ReportSort) {
    if (key === sort) setDirection(direction === "asc" ? "desc" : "asc");
    else {
      setSort(key);
      setDirection("asc");
    }
    setPage(0);
  }
  const heading = (label: string, key?: ReportSort) =>
    key ? (
      <th aria-sort={sort === key ? (direction === "asc" ? "ascending" : "descending") : undefined}>
        <button type="button" className="report-sort" onClick={() => sortBy(key)}>
          {label}
          {sort === key ? (direction === "asc" ? " ▲" : " ▼") : ""}
        </button>
      </th>
    ) : (
      <th>{label}</th>
    );

  if (error) return <p className="error-text">Couldn&apos;t load the reports: {(error as Error).message}</p>;
  if (isLoading || !data) return <p className="hint-text">Loading reports…</p>;
  if (data.total === 0) return <p className="hint-text">No reports.</p>;

  const pageCount = Math.max(1, Math.ceil(data.total / pageSize));
  const from = page * pageSize + 1;
  const to = Math.min((page + 1) * pageSize, data.total);
  const cell = (v: number | null) => (v == null ? dash : v);

  return (
    <div className={isFetching ? "reports-table loading" : "reports-table"}>
      <div className="matrix-scroll">
        <table className="data-table compact-table">
          <thead>
            <tr>
              {heading(showFile ? "File, line" : "Line", "line")}
              {heading("Time", "time")}
              {heading("Track", "track")}
              <th>PRI type</th>
              {heading("RF (MHz)", "rf")}
              {heading("PRI (µs)", "pri")}
              {heading("PW (µs)", "pw")}
              <th>Jitter / stagger (µs)</th>
              {heading("Power (dBm)", "power")}
              <th>Identified as</th>
              {entryLabel && <th>Entry</th>}
            </tr>
          </thead>
          <tbody>
            {data.items.map((r: InterceptReport) => (
              <tr key={r.id}>
                <td className="cell-nowrap">
                  {showFile && r.source_file && <span className="hint-text">{r.source_file} · </span>}
                  {r.file_line}
                </td>
                <td className="cell-nowrap">{missionTime(r.mission_time)}</td>
                <td>{r.track ?? dash}</td>
                <td>{PRI_TYPE_LABEL[r.pri_type] ?? r.pri_type}</td>
                <td>{r.rf_mhz}</td>
                <td>
                  {cell(r.pri_us)}
                  {r.pri_type === "stagger" && r.pri_us != null && <span className="hint-text"> frame</span>}
                </td>
                <td>{cell(r.pw_us)}</td>
                <td className="entry-jitter" title={r.stagger_us?.join(", ")}>
                  {r.pri_type === "fixed" ? cell(r.jitter_us) : r.stagger_us ? r.stagger_us.join(", ") : dash}
                </td>
                <td>{cell(r.power)}</td>
                <td>
                  {r.designation ?? <span className="hint-text">not identified</span>}
                  {r.mode_name && <span className="hint-text"> / {r.mode_name}</span>}
                </td>
                {entryLabel && (
                  <td className={r.entry_id ? undefined : "hint-text"}>{entryLabel(r.entry_id)}</td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="list-pager">
        <button type="button" className="button secondary small" disabled={page === 0} onClick={() => setPage(page - 1)}>
          ← Previous
        </button>
        <span>
          Reports {from.toLocaleString()}–{to.toLocaleString()} of {data.total.toLocaleString()}
        </span>
        <button
          type="button"
          className="button secondary small"
          disabled={page >= pageCount - 1}
          onClick={() => setPage(page + 1)}
        >
          Next →
        </button>
      </div>
    </div>
  );
}
