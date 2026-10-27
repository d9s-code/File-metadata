import { useState } from "react";
import { formatDate, formatDateTime } from "../common/dates";
import { Link } from "react-router-dom";
import type { AmbiguityFinding, ComparedSide, OverlapParam } from "../../api/ambiguity";
import { useAuth } from "../../auth/AuthContext";
import { useReviewFinding, useUnreviewFinding } from "../../state/hooks/useAmbiguity";
import { SeverityBadge } from "./SeverityBadge";
import { AiFindingExplanation } from "./AiDrafts";
import { MergeDialog } from "./MergeDialog";
import { PARAMS, comparedSides, limitingParam, num, overlapPct, pct, priLabel, rangeText } from "./ambiguityText";

/** Two ranges on one scale: A above B, the part they share shaded. */
function RangePair({ a, b }: { a: [number, number]; b: [number, number] }) {
  const lo = Math.min(a[0], b[0]);
  const hi = Math.max(a[1], b[1]);
  const span = hi - lo || Math.max(Math.abs(hi) * 0.01, 1);
  const pad = span * 0.04;
  const x = (v: number) => ((v - (lo - pad)) / (span + 2 * pad)) * 100;
  const bar = (r: [number, number]) => ({ left: `${x(r[0])}%`, width: `${Math.max(0.8, x(r[1]) - x(r[0]))}%` });
  const shared: [number, number] | null = Math.max(a[0], b[0]) <= Math.min(a[1], b[1]) ? [Math.max(a[0], b[0]), Math.min(a[1], b[1])] : null;
  return (
    <div className="range-pair" aria-hidden>
      {shared && <div className="range-pair-shared" style={bar(shared)} />}
      <div className="range-pair-bar side-a" style={bar(a)} />
      <div className="range-pair-bar side-b" style={bar(b)} />
      <span className="range-pair-edge left">{num(lo)}</span>
      <span className="range-pair-edge right">{num(hi)}</span>
    </div>
  );
}

/** Two stagger sequences as dots; steps they share are ringed. */
function StaggerPair({ a, b }: { a: number[]; b: number[] }) {
  const all = [...a, ...b];
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  const span = hi - lo || 1;
  const x = (v: number) => 4 + ((v - lo) / span) * 92;
  const shared = new Set(a.filter((v) => b.includes(v)));
  return (
    <div className="range-pair" aria-hidden>
      {a.map((v, i) => (
        <span key={`a${i}`} className={`stagger-dot side-a${shared.has(v) ? " shared" : ""}`} style={{ left: `${x(v)}%` }} />
      ))}
      {b.map((v, i) => (
        <span key={`b${i}`} className={`stagger-dot side-b${shared.has(v) ? " shared" : ""}`} style={{ left: `${x(v)}%` }} />
      ))}
      <span className="range-pair-edge left">{num(lo)}</span>
      <span className="range-pair-edge right">{num(hi)}</span>
    </div>
  );
}

function ParamRow({
  param,
  label,
  unit,
  a,
  b,
  value,
  limiting,
}: {
  param: OverlapParam;
  label: string;
  unit: string;
  a: ComparedSide;
  b: ComparedSide;
  value: number | null;
  limiting: boolean;
}) {
  const pick = (s: ComparedSide) =>
    param === "rf" ? s.rf : param === "pw" ? s.pw : param === "jitter" ? (s.jitter ?? null) : (s.pri ?? s.frame_time ?? null);
  const ra = pick(a);
  const rb = pick(b);
  const staggers = param === "pri" && !ra && a.stagger && b.stagger;
  const text = (r: [number, number] | null, s: number[] | null) => (r ? rangeText(r) : s ? s.map(num).join(", ") : "—");
  return (
    <div className={`param-row${limiting ? " limiting" : ""}`}>
      <div className="param-row-head">
        <strong>{label}</strong> <span className="hint-text">{unit}</span>
        <span className="param-row-values">
          <span className="side-a-text">A {text(ra, a.stagger)}</span>
          <span className="side-b-text">B {text(rb, b.stagger)}</span>
        </span>
        <span className="param-row-pct" title={limiting ? "The least overlap — it sets the severity" : undefined}>
          {value == null ? "not compared" : pct(value)}
          {limiting && <span className="param-row-tag">sets severity</span>}
        </span>
      </div>
      {staggers ? (
        <StaggerPair a={a.stagger as number[]} b={b.stagger as number[]} />
      ) : ra && rb ? (
        <RangePair a={ra} b={rb} />
      ) : null}
    </div>
  );
}

function emitterLink(side: AmbiguityFinding["details"]["mode_a"]) {
  return `/emitters/${side.emitter_id}?tab=modes&mode=${encodeURIComponent(side.mode_name)}`;
}

/** The selected finding: what overlaps and by how much, and what to do. */
export function FindingDetail({
  finding,
  runId,
  aiEnabled,
  marginsApplied,
  goneModeIds,
}: {
  finding: AmbiguityFinding;
  runId: string;
  aiEnabled: boolean;
  marginsApplied: boolean;
  goneModeIds: Set<string>;
}) {
  const { user } = useAuth();
  const isEditor = user?.role === "editor" || user?.role === "admin";
  const review = useReviewFinding(runId);
  const unreview = useUnreviewFinding(runId);
  const [note, setNote] = useState("");
  const [merging, setMerging] = useState(false);
  const [acknowledging, setAcknowledging] = useState(false);
  const { mode_a, mode_b } = finding.details;
  const { a, b } = comparedSides(finding);
  const limiting = limitingParam(finding);
  const sameEmitter = mode_a.emitter_id === mode_b.emitter_id;
  const gone = !finding.resolution && (goneModeIds.has(finding.mode_id_a) || goneModeIds.has(finding.mode_id_b));
  const params = PARAMS.filter((p) => overlapPct(finding, p.key) != null);

  return (
    <div className="finding-detail">
      <div className="finding-detail-head">
        <h3>
          <span className="side-a-text">{mode_a.mode_name}</span> ↔ <span className="side-b-text">{mode_b.mode_name}</span>
        </h3>
        <SeverityBadge severity={finding.combined_severity} />
      </div>
      <p className="hint-text finding-detail-where">
        A: {mode_a.emitter_name} › {mode_a.ew_group_name} · {(mode_a.source_names?.length ?? 1) > 1 ? "sources" : "source"} {mode_a.source_name}
        <br />
        B: {mode_b.emitter_name} › {mode_b.ew_group_name} · {(mode_b.source_names?.length ?? 1) > 1 ? "sources" : "source"} {mode_b.source_name}
      </p>

      <div className="param-rows">
        {params.map((p) => (
          <ParamRow
            key={p.key}
            param={p.key}
            label={p.key === "pri" ? priLabel(finding) : p.label}
            unit={p.unit}
            a={a}
            b={b}
            value={overlapPct(finding, p.key)}
            limiting={p.key === limiting}
          />
        ))}
      </div>
      <p className="hint-text">
        {marginsApplied ? "Ranges include each Mode's ± delta." : "This check compared the ranges as typed, without deltas."}{" "}
        Overlap is the share of the narrower range the other covers.
        {finding.details.pri_basis === "frame_time" && " Both use range matching, so PRI is compared on frame time (± frame delta)."}
        {finding.details.pri_basis === "steps" && " PRI is the share of stagger steps that are identical."}
        {finding.pri_overlap_pct == null && " CW and X-let have no PRI, so it isn't compared."}
      </p>

      {finding.resolution ? (
        <div className="finding-outcome merged">
          <strong>Merged</strong> by {finding.resolution.by} on {formatDateTime(finding.resolution.at)}: kept{" "}
          <strong>{finding.resolution.kept_name}</strong>, widened to cover both, and deleted{" "}
          <strong>{finding.resolution.removed_name}</strong>. This is in {mode_a.emitter_name}&apos;s unsaved changes —{" "}
          <Link to={`/emitters/${mode_a.emitter_id}`}>save a version there</Link>, then run the check again.
        </div>
      ) : gone ? (
        <div className="finding-outcome">
          One of these Modes has been merged into another since this check. Run the check again (after saving the
          Emitter) to see where this pair stands.
        </div>
      ) : finding.reviewed_at ? (
        <div className="finding-outcome acknowledged">
          <strong>Acknowledged</strong> {formatDate(finding.reviewed_at)}
          {finding.reviewer_note && <>: {finding.reviewer_note}</>}
          {isEditor && (
            <>
              {" "}
              <button type="button" className="link-button" onClick={() => unreview.mutate(finding.id)}>
                Undo
              </button>
            </>
          )}
        </div>
      ) : null}

      {!finding.resolution && !gone && (
        <div className="finding-actions">
          {acknowledging ? (
            <>
              <input
                className="finding-note"
                placeholder="Why (optional), e.g. told apart by scan pattern"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                autoFocus
              />
              <button
                type="button"
                disabled={review.isPending}
                onClick={() =>
                  review.mutate(
                    { findingId: finding.id, note: note.trim() || undefined },
                    {
                      onSuccess: () => {
                        setNote("");
                        setAcknowledging(false);
                      },
                    },
                  )
                }
              >
                Acknowledge
              </button>
              <button type="button" className="button secondary" onClick={() => setAcknowledging(false)}>
                Cancel
              </button>
            </>
          ) : (
            <>
              <Link
                className="button secondary"
                to={emitterLink(mode_a)}
                title="Change it in its Emitter, then save a version and run the check again"
              >
                Open A
              </Link>
              <Link
                className="button secondary"
                to={emitterLink(mode_b)}
                title="Change it in its Emitter, then save a version and run the check again"
              >
                Open B
              </Link>
              {isEditor && (
                <button
                  type="button"
                  className="button secondary"
                  disabled={!sameEmitter}
                  onClick={() => setMerging(true)}
                  title={
                    sameEmitter
                      ? "Two Modes that are really the same: keep one, widened to cover both, and delete the other"
                      : "Only Modes of the same Emitter can be merged"
                  }
                >
                  Merge…
                </button>
              )}
              {isEditor && !finding.reviewed_at && (
                <button
                  type="button"
                  onClick={() => setAcknowledging(true)}
                  title="Known and acceptable as it is — kept on later checks while nothing changes"
                >
                  Acknowledge…
                </button>
              )}
            </>
          )}
        </div>
      )}

      {aiEnabled && <AiFindingExplanation finding={finding} runId={runId} />}
      {merging && <MergeDialog finding={finding} runId={runId} onClose={() => setMerging(false)} />}
    </div>
  );
}
