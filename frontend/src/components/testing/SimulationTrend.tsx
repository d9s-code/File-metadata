import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { TestRecord } from "../../api/testRecords";
import { useEmitterVersions } from "../../state/hooks/useEmitterVersions";
import { fmt, niceTicks, useWidth } from "../intercepts/charts/Histogram";

const HEIGHT = 200;
const M = { left: 40, right: 12, top: 12, bottom: 34 };
const BAR_MAX = 24;
const SEGMENT_GAP = 2;

const OUTCOMES = [
  { key: "pass", label: "Correct", cls: "status-good" },
  { key: "partial", label: "Misclassified", cls: "status-warning" },
  { key: "fail", label: "Missed", cls: "status-critical" },
  { key: "inconclusive", label: "Inconclusive", cls: "status-neutral" },
] as const;

type Counts = Record<(typeof OUTCOMES)[number]["key"], number>;

function shortDate(day: string) {
  return new Date(`${day}T00:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "2-digit" });
}

/** How each simulation run went, oldest to newest: one column per run,
 * stacked by SIM Test Line outcome. Runs logged without per-line outcomes
 * aren't shown. Click a column to open that run. */
export function SimulationTrend({ emitterId, records }: { emitterId: string; records: TestRecord[] }) {
  const navigate = useNavigate();
  const { data: versions } = useEmitterVersions(emitterId);
  const { ref, width } = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  const runs = useMemo(() => {
    const versionById = new Map((versions ?? []).map((v) => [v.id, v.version_number]));
    return records
      .filter((r) => r.lines.length > 0)
      .sort((a, b) => a.test_date.localeCompare(b.test_date) || a.created_at.localeCompare(b.created_at))
      .map((r) => {
        const counts: Counts = { pass: 0, partial: 0, fail: 0, inconclusive: 0 };
        for (const l of r.lines) counts[l.outcome] += 1;
        return {
          record: r,
          counts,
          total: r.lines.length,
          version: r.emitter_version_id ? (versionById.get(r.emitter_version_id) ?? null) : null,
        };
      });
  }, [records, versions]);

  if (runs.length === 0) return null;

  const plotW = Math.max(10, width - M.left - M.right);
  const plotH = HEIGHT - M.top - M.bottom;
  const maxTotal = Math.max(1, ...runs.map((r) => r.total));
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
          {OUTCOMES.map((o) => (
            <span key={o.key}>
              <span className={`viz-swatch ${o.cls}`} /> {o.label}
            </span>
          ))}
        </span>
      </div>
      <p className="hint-text">
        SIM Test Line outcomes per simulation run, oldest to newest. Latest:{" "}
        <strong>
          {latest.counts.pass} of {latest.total} correct
        </strong>
        {latest.version != null && ` on version ${latest.version}`}. Click a column to open that run.
      </p>
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
            const shown = OUTCOMES.filter((o) => run.counts[o.key] > 0);
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
                    <rect
                      key={o.key}
                      className={`trend-seg ${o.cls}`}
                      x={cx - barW / 2}
                      y={base + (isTop ? 0 : SEGMENT_GAP)}
                      width={barW}
                      height={segH}
                      rx={isTop ? Math.min(4, barW / 2) : 0}
                    />
                  );
                })}
                {i % labelEvery === 0 && (
                  <text className="viz-axis-label" x={cx} y={HEIGHT - 12} textAnchor="middle">
                    {shortDate(run.record.test_date)}
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
              {hovered.record.test_date}
              {hovered.version != null ? ` · version ${hovered.version}` : " · before the first saved version"}
            </div>
            {OUTCOMES.map((o) => (
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
