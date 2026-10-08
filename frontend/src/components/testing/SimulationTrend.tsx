import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { TestRecord } from "../../api/testRecords";
import { useEmitterVersions } from "../../state/hooks/useEmitterVersions";
import { fmt, niceTicks, useWidth } from "../intercepts/charts/Histogram";

const HEIGHT = 216;
const M = { left: 40, right: 12, top: 12, bottom: 44 };
const BAR_MAX = 24;
const SEGMENT_GAP = 2;

const OUTCOMES = [
  { key: "pass", label: "Correct", cls: "status-good" },
  { key: "partial", label: "Partial", cls: "status-warning" },
  { key: "fail", label: "Missed", cls: "status-critical" },
  { key: "inconclusive", label: "Inconclusive", cls: "status-neutral" },
] as const;

type Counts = Record<(typeof OUTCOMES)[number]["key"] | "not_run", number>;

// SIM Test Lines the run didn't include, so every column adds up to all of them.
const NOT_RUN = { key: "not_run", label: "Not in this run", cls: "trend-not-run" } as const;
const PREFS_KEY = "sim-trend-prefs";

function shortDate(day: string) {
  return new Date(`${day}T00:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "2-digit" });
}

/** When a run happened: its date and time — or, for runs logged before times
 * were kept, the time it was logged (marked as such). */
function runTime(r: TestRecord): { time: string; logged: boolean; sortKey: string } {
  if (r.test_time) return { time: r.test_time.slice(0, 5), logged: false, sortKey: `${r.test_date}T${r.test_time}` };
  const at = new Date(r.created_at);
  const time = `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
  return { time, logged: true, sortKey: `${r.test_date}T${time}:00` };
}

function loadPrefs(): { notRun: boolean; counts: boolean } {
  try {
    return { notRun: true, counts: false, ...JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") };
  } catch {
    return { notRun: true, counts: false };
  }
}

/** How each simulation run went, oldest to newest: one column per run,
 * stacked by SIM Test Line outcome — and, unless switched off, the lines the
 * run didn't include, so every column is all of the Emitter's SIM Test
 * Lines. Runs logged without per-line outcomes aren't shown. Click a column
 * to open that run. */
export function SimulationTrend({
  emitterId,
  records,
  lineIds,
}: {
  emitterId: string;
  records: TestRecord[];
  /** Every SIM Test Line the Emitter has now. */
  lineIds: string[];
}) {
  const navigate = useNavigate();
  const { data: versions } = useEmitterVersions(emitterId);
  const { ref, width } = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const [prefs, setPrefs] = useState(loadPrefs);
  function setPref(change: Partial<typeof prefs>) {
    const next = { ...prefs, ...change };
    setPrefs(next);
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(next));
    } catch {
      // kept for this visit only
    }
  }

  const runs = useMemo(() => {
    const versionById = new Map((versions ?? []).map((v) => [v.id, v.version_number]));
    return records
      .filter((r) => r.lines.length > 0)
      .map((r) => ({ r, when: runTime(r) }))
      .sort((a, b) => a.when.sortKey.localeCompare(b.when.sortKey) || a.r.created_at.localeCompare(b.r.created_at))
      .map(({ r, when }) => {
        const counts: Counts = { pass: 0, partial: 0, fail: 0, inconclusive: 0, not_run: 0 };
        for (const l of r.lines) counts[l.outcome] += 1;
        const inRun = new Set(r.lines.map((l) => l.test_line_id));
        counts.not_run = lineIds.filter((id) => !inRun.has(id)).length;
        return {
          record: r,
          when,
          counts,
          ran: r.lines.length,
          version: r.emitter_version_id ? (versionById.get(r.emitter_version_id) ?? null) : null,
        };
      });
  }, [records, versions, lineIds]);

  if (runs.length === 0) return null;

  const plotW = Math.max(10, width - M.left - M.right);
  const plotH = HEIGHT - M.top - M.bottom;
  const segments = prefs.notRun ? [...OUTCOMES, NOT_RUN] : OUTCOMES;
  const totalOf = (r: (typeof runs)[number]) => r.ran + (prefs.notRun ? r.counts.not_run : 0);
  const maxTotal = Math.max(1, ...runs.map(totalOf));
  const ticks = niceTicks(0, maxTotal, 4).filter((t) => Number.isInteger(t));
  const top = Math.max(maxTotal, ticks[ticks.length - 1] ?? maxTotal);
  const y = (v: number) => (v / top) * plotH;
  const slot = plotW / runs.length;
  const barW = Math.min(BAR_MAX, Math.max(4, slot * 0.6));
  const labelEvery = Math.max(1, Math.ceil(70 / slot));
  const latest = runs[runs.length - 1];
  const hovered = hover != null ? runs[hover] : null;

  return (
    <div className="card">
      <div className="card-header">
        <h4>Simulation trend</h4>
        <span className="viz-legend">
          {segments.map((o) => (
            <span key={o.key}>
              <span className={`viz-swatch ${o.cls}`} /> {o.label}
            </span>
          ))}
        </span>
      </div>
      <div className="trend-controls">
        <span className="hint-text">
          SIM Test Line outcomes per simulation run, oldest to newest. Latest:{" "}
          <strong>
            {latest.counts.pass} of {latest.ran} correct
          </strong>
          {latest.counts.not_run > 0 && ` (${latest.counts.not_run} not in the run)`}
          {latest.version != null && ` on version ${latest.version}`}. Click a column to open that run.
        </span>
        <label className="inline-check">
          <input type="checkbox" checked={prefs.notRun} onChange={(e) => setPref({ notRun: e.target.checked })} />
          Lines not in the run
        </label>
        <label className="inline-check">
          <input type="checkbox" checked={prefs.counts} onChange={(e) => setPref({ counts: e.target.checked })} />
          Counts
        </label>
      </div>
      <div ref={ref} className="viz-plot" onPointerLeave={() => setHover(null)}>
        <svg width={width} height={HEIGHT} aria-label="SIM Test Line outcomes per run">
          {ticks.map((t) => (
            <g key={t}>
              <line className="viz-grid" x1={M.left} x2={M.left + plotW} y1={M.top + plotH - y(t)} y2={M.top + plotH - y(t)} />
              <text className="viz-axis-label" x={M.left - 6} y={M.top + plotH - y(t) + 4} textAnchor="end">
                {fmt(t)}
              </text>
            </g>
          ))}
          {runs.map((run, i) => {
            const cx = M.left + slot * i + slot / 2;
            let base = M.top + plotH;
            const shown = segments.filter((o) => run.counts[o.key] > 0);
            return (
              <g
                key={run.record.id}
                className={hover === i ? "trend-run hovered" : "trend-run"}
                onPointerEnter={() => setHover(i)}
                onClick={() => navigate(`/emitters/${emitterId}/tests/${run.record.id}`)}
              >
                <rect className="trend-hit" x={cx - slot / 2} y={M.top} width={slot} height={plotH} />
                {shown.map((o, k) => {
                  const h = y(run.counts[o.key]);
                  const isTop = k === shown.length - 1;
                  // A 2px surface gap between segments; the top one gets a rounded end.
                  const segH = Math.max(1, h - (isTop ? 0 : SEGMENT_GAP));
                  base -= h;
                  return (
                    <g key={o.key}>
                      <rect
                        className={`trend-seg ${o.cls}`}
                        x={cx - barW / 2}
                        y={base + (isTop ? 0 : SEGMENT_GAP)}
                        width={barW}
                        height={segH}
                        rx={isTop ? Math.min(4, barW / 2) : 0}
                      />
                      {prefs.counts && segH >= 12 && barW >= 14 && (
                        <text className="trend-count" x={cx} y={base + (isTop ? 0 : SEGMENT_GAP) + segH / 2 + 4} textAnchor="middle">
                          {run.counts[o.key]}
                        </text>
                      )}
                    </g>
                  );
                })}
                {i % labelEvery === 0 && (
                  <text className="viz-axis-label" x={cx} y={HEIGHT - 24} textAnchor="middle">
                    <tspan x={cx}>{shortDate(run.record.test_date)}</tspan>
                    <tspan x={cx} dy={13} className={run.when.logged ? "trend-time-logged" : undefined}>
                      {run.when.time}
                    </tspan>
                  </text>
                )}
              </g>
            );
          })}
          <line className="viz-baseline" x1={M.left} x2={M.left + plotW} y1={M.top + plotH} y2={M.top + plotH} />
        </svg>
        {hovered && hover != null && (
          <div
            className="viz-tooltip"
            style={{ left: Math.min(Math.max(M.left + slot * hover + slot / 2 + 12, 8), Math.max(8, width - 230)) }}
          >
            <div>
              <strong>{hovered.record.title}</strong>
            </div>
            <div className="hint-text">
              {hovered.record.test_date} {hovered.when.time}
              {hovered.when.logged ? " (when logged — no test time recorded)" : ""}
              {hovered.version != null ? ` · version ${hovered.version}` : " · before the first saved version"}
            </div>
            {[...OUTCOMES, NOT_RUN].map((o) => (
              <div key={o.key}>
                <span className={`viz-swatch ${o.cls}`} /> {hovered.counts[o.key]} {o.label.toLowerCase()}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
