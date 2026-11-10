import { useState } from "react";
import { formatDate, formatDateTime } from "../common/dates";
import { Link } from "react-router-dom";
import type { AmbiguityFinding, ComparedSide, FindingModeSide, OverlapParam } from "../../api/ambiguity";
import { useAuth } from "../../auth/AuthContext";
import { useReviewFinding, useUnreviewFinding } from "../../state/hooks/useAmbiguity";
import { SeverityBadge } from "./SeverityBadge";
import { AiFindingExplanation } from "./AiDrafts";
import { MergeDialog } from "./MergeDialog";
import { PARAMS, comparedSides, limitingParam, num, overlapPct, pct, priLabel, rangeText } from "./ambiguityText";
import {
  decidingText,
  directional,
  separationChange,
  separations,
  sharedStepsOf,
  sideRange,
  sideSteps,
  stepDelta,
} from "./ambiguityAnalysis";
import { AmbiguityModeEdit } from "./AmbiguityModeEdit";
import type { LineValues } from "../modes/modeLine";

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
function StaggerPair({ a, b, delta }: { a: number[]; b: number[]; delta: number }) {
  const all = [...a, ...b];
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  const span = hi - lo || 1;
  const x = (v: number) => 4 + ((v - lo) / span) * 92;
  // Within reach of the other's: each step ± delta.
  const shared = new Set([...sharedStepsOf(a, b, delta), ...sharedStepsOf(b, a, delta)]);
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
  steps,
}: {
  param: OverlapParam;
  label: string;
  unit: string;
  a: ComparedSide;
  b: ComparedSide;
  value: number | null;
  limiting: boolean;
  /** Each stagger step's ± buffer, when steps were compared. */
  steps?: number;
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
        <StaggerPair a={a.stagger as number[]} b={b.stagger as number[]} delta={steps ?? 0} />
      ) : ra && rb ? (
        <RangePair a={ra} b={rb} />
      ) : null}
    </div>
  );
}

function emitterLink(side: AmbiguityFinding["details"]["mode_a"]) {
  return `/emitters/${side.emitter_id}?tab=modes&mode=${encodeURIComponent(side.mode_name)}`;
}

const share = (v: number) => `${Math.round(v * 100)}%`;

/** The overlap each way, in a sentence: a narrow Mode inside a wide one is
 * all of the one and little of the other. */
function DirectionLine({ finding }: { finding: AmbiguityFinding }) {
  const d = directional(finding);
  const { mode_a: a, mode_b: b } = finding.details;
  return (
    <p className="finding-direction">
      <span>
        <b className="figure">{share(d.aInB)}</b> of <b className="side-a-text">A</b> {a.mode_name}&apos;s box lies inside{" "}
        <b className="side-b-text">B</b> {b.mode_name}&apos;s
      </span>
      <span>
        <b className="figure">{share(d.bInA)}</b> of <b className="side-b-text">B</b> {b.mode_name}&apos;s inside{" "}
        <b className="side-a-text">A</b> {a.mode_name}&apos;s
      </span>
    </p>
  );
}

export type EditRequest = { side: "a" | "b"; lineChange?: Partial<LineValues> };

/** The smallest moves that would tell the two apart, each one click from the
 * Mode's edit window, started with the change. */
function TellApart({
  finding,
  canEdit,
  liveLines,
  onEdit,
}: {
  finding: AmbiguityFinding;
  canEdit: boolean;
  liveLines: { a?: Record<string, unknown> | null; b?: Record<string, unknown> | null };
  onEdit: (r: EditRequest) => void;
}) {
  const names = { a: finding.details.mode_a.mode_name, b: finding.details.mode_b.mode_name };
  const seps = separations(finding).slice(0, 3);
  return (
    <div className="tell-apart">
      <h4 className="readout-label">To tell them apart</h4>
      <ul>
        {seps.map((s) => (
          <li key={s.param}>
            <span className="tell-apart-param">{s.label}</span>
            {s.sharedSteps ? (
              <span>
                {s.sharedSteps.length} step{s.sharedSteps.length === 1 ? "" : "s"} ({s.sharedSteps.map(num).join(", ")} µs) within ±{" "}
                {num(stepDelta(finding))} µs of the other&apos;s — move them more than {num(2 * stepDelta(finding))} µs apart
                in either Mode.
              </span>
            ) : s.identical ? (
              <span className="hint-text">Identical ranges — one of them would have to move entirely.</span>
            ) : (
              <span className="tell-apart-options">
                {s.options.map((o) => {
                  const side = o.side === "a" ? finding.details.mode_a : finding.details.mode_b;
                  const change = separationChange(finding, o, o.side === "a" ? liveLines.a : liveLines.b);
                  return (
                    <span key={`${o.side}${o.edge}`} className="tell-apart-option">
                      <span>
                        <span className={o.side === "a" ? "side-a-text" : "side-b-text"}>{side.mode_name}</span>&apos;s {o.edge}{" "}
                        <span className="figure">{num(o.from)}</span> → <span className="figure">{num(o.target)}</span>{" "}
                        <span className="hint-text">
                          {s.unit} · moves {num(Math.round(o.amount * 1000) / 1000)}
                        </span>
                      </span>
                      {canEdit && change && (
                        <button
                          type="button"
                          className="link-button"
                          title={`Opens ${side.mode_name}'s edit window with this ${o.edge} filled in (its typed value, the ± delta taken off) — check it, then Save`}
                          onClick={() => onEdit({ side: o.side, lineChange: change })}
                        >
                          Edit like this…
                        </button>
                      )}
                    </span>
                  );
                })}
              </span>
            )}
          </li>
        ))}
      </ul>
      <p className="hint-text">
        Edges as compared{finding.details.margins_applied === false ? "" : ", ± delta included"}; touching ends don&apos;t
        overlap. {names.a} and {names.b} stay ambiguous until the change is saved as a version and the check runs again.
      </p>
    </div>
  );
}

/** The selected finding: the verdict first, the parameter that decides it
 * large, the rest in a line each, then how to tell them apart and what to do. */
export function FindingDetail({
  finding,
  runId,
  aiEnabled,
  marginsApplied,
  goneModeIds,
  change,
  liveLines,
}: {
  finding: AmbiguityFinding;
  runId: string;
  aiEnabled: boolean;
  marginsApplied: boolean;
  goneModeIds: Set<string>;
  /** Whether each Mode has changed (or gone) since this check. */
  change: { a: "changed" | "gone" | null; b: "changed" | "gone" | null };
  /** The Modes' lines now, for turning a suggested move into typed values. */
  liveLines: { a?: Record<string, unknown> | null; b?: Record<string, unknown> | null };
}) {
  const { user } = useAuth();
  const isEditor = user?.role === "editor" || user?.role === "admin";
  const review = useReviewFinding(runId);
  const unreview = useUnreviewFinding(runId);
  const [note, setNote] = useState("");
  const [merging, setMerging] = useState(false);
  const [acknowledging, setAcknowledging] = useState(false);
  const [editing, setEditing] = useState<EditRequest | null>(null);
  const { mode_a, mode_b } = finding.details;
  const { a, b } = comparedSides(finding);
  const limiting = limitingParam(finding);
  const sameEmitter = mode_a.emitter_id === mode_b.emitter_id;
  const gone = !finding.resolution && (goneModeIds.has(finding.mode_id_a) || goneModeIds.has(finding.mode_id_b));
  const params = PARAMS.filter((p) => overlapPct(finding, p.key) != null);
  const deciding = params.find((p) => p.key === limiting);
  const others = params.filter((p) => p.key !== limiting);
  const canAct = !finding.resolution && !gone;
  const edited = (side: FindingModeSide, c: "changed" | "gone" | null) =>
    c && (
      <span className={`finding-changed ${c}`} title="Since this check — run it again to see where the pair stands">
        {side.mode_name} {c === "gone" ? "deleted" : "edited"} since
      </span>
    );

  return (
    <div className="finding-detail">
      <div className="finding-detail-head">
        <h3>
          <span className="side-a-text">{mode_a.mode_name}</span>
          {!sameEmitter && <small className="hint-text"> {mode_a.emitter_name}</small>} ↔{" "}
          <span className="side-b-text">{mode_b.mode_name}</span>
          {!sameEmitter && <small className="hint-text"> {mode_b.emitter_name}</small>}
        </h3>
        <SeverityBadge severity={finding.combined_severity} />
      </div>
      <p className="hint-text finding-detail-where">
        <span>
          <b className="side-a-text">A</b> {mode_a.emitter_name} › {mode_a.ew_group_name} · {mode_a.source_name}
        </span>
        <span>
          <b className="side-b-text">B</b> {mode_b.emitter_name} › {mode_b.ew_group_name} · {mode_b.source_name}
        </span>
      </p>
      {(change.a || change.b) && (
        <p className="finding-changes">
          {edited(mode_a, change.a)}
          {edited(mode_b, change.b)}
        </p>
      )}

      <p className="finding-verdict">{decidingText(finding)}</p>
      <DirectionLine finding={finding} />

      {deciding && (
        <div className="param-rows">
          <ParamRow
            param={deciding.key}
            label={deciding.key === "pri" ? priLabel(finding) : deciding.label}
            unit={deciding.unit}
            a={a}
            b={b}
            value={overlapPct(finding, deciding.key)}
            limiting
            steps={stepDelta(finding)}
          />
        </div>
      )}
      {others.length > 0 && (
        <table className="param-compact">
          <tbody>
            {others.map((p) => {
              const v = overlapPct(finding, p.key);
              const ra = sideRange(a, p.key);
              const rb = sideRange(b, p.key);
              const sa = sideSteps(a, p.key);
              const sb = sideSteps(b, p.key);
              return (
                <tr key={p.key}>
                  <th>
                    {p.key === "pri" ? priLabel(finding) : p.label} <span className="hint-text">{p.unit}</span>
                  </th>
                  <td className="side-a-text figure">{ra ? rangeText(ra) : (sa ?? []).map(num).join(", ")}</td>
                  <td className="side-b-text figure">{rb ? rangeText(rb) : (sb ?? []).map(num).join(", ")}</td>
                  <td className="figure param-compact-pct">{v != null && v >= 99.95 ? "full" : pct(v)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {finding.resolution ? (
        <div className="finding-outcome merged">
          <strong>Merged</strong> by {finding.resolution.by} on {formatDateTime(finding.resolution.at)}: kept{" "}
          <strong>{finding.resolution.kept_name}</strong>, widened to cover both, and deleted{" "}
          <strong>{finding.resolution.removed_name}</strong>. Save a version of {mode_a.emitter_name}, then run the check again.
        </div>
      ) : gone ? (
        <div className="finding-outcome">
          One of these Modes has been merged into another since this check. Save a version, then run the check again to see
          where this pair stands.
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

      {canAct && (
        <div className="finding-actions">
          {acknowledging ? (
            <>
              <input
                className="finding-note"
                placeholder="Why (optional), e.g. told apart by scan pattern"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.currentTarget.nextElementSibling as HTMLButtonElement | null)?.click();
                }}
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
              {isEditor ? (
                <>
                  <button
                    type="button"
                    className="button secondary"
                    title={`Edit ${mode_a.mode_name} of ${mode_a.emitter_name}, here`}
                    onClick={() => setEditing({ side: "a" })}
                  >
                    Edit <b className="side-a-text">A</b> {mode_a.mode_name}
                  </button>
                  <button
                    type="button"
                    className="button secondary"
                    title={`Edit ${mode_b.mode_name} of ${mode_b.emitter_name}, here`}
                    onClick={() => setEditing({ side: "b" })}
                  >
                    Edit <b className="side-b-text">B</b> {mode_b.mode_name}
                  </button>
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
                  {!finding.reviewed_at && (
                    <button
                      type="button"
                      onClick={() => setAcknowledging(true)}
                      title="Known and acceptable as it is — kept on later checks while nothing changes (A)"
                    >
                      Acknowledge…
                    </button>
                  )}
                </>
              ) : (
                <span className="hint-text">Viewers can look; an Editor changes Modes.</span>
              )}
              <span className="finding-open-links hint-text">
                Open in its Emitter: <Link to={emitterLink(mode_a)}>A {mode_a.mode_name}</Link> ·{" "}
                <Link to={emitterLink(mode_b)}>B {mode_b.mode_name}</Link>
              </span>
            </>
          )}
        </div>
      )}

      {canAct && <TellApart finding={finding} canEdit={isEditor} liveLines={liveLines} onEdit={setEditing} />}

      <p className="hint-text finding-footnote">
        {marginsApplied ? "Ranges include each Mode's ± delta." : "This check compared the ranges as typed, without deltas."}{" "}
        A parameter&apos;s overlap is the share of the narrower range the other covers.
        {finding.details.pri_basis === "frame_time" && " Both use range matching, so PRI is compared on frame time (± frame delta)."}
        {finding.details.pri_basis === "steps" &&
          (stepDelta(finding)
            ? ` PRI is the share of stagger steps within reach of the other's — each step ± ${num(stepDelta(finding))} µs.`
            : " PRI is the share of stagger steps that are identical.")}
        {finding.pri_overlap_pct == null && " CW and X-let have no PRI, so it isn't compared."}
      </p>

      {aiEnabled && <AiFindingExplanation finding={finding} runId={runId} />}
      {merging && <MergeDialog finding={finding} runId={runId} onClose={() => setMerging(false)} />}
      {editing && (
        <AmbiguityModeEdit
          emitterId={(editing.side === "a" ? mode_a : mode_b).emitter_id}
          modeId={editing.side === "a" ? finding.mode_id_a : finding.mode_id_b}
          modeName={(editing.side === "a" ? mode_a : mode_b).mode_name}
          lineChange={editing.lineChange}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
