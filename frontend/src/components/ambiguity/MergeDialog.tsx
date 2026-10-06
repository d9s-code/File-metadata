import { useState } from "react";
import { Link } from "react-router-dom";
import type { AmbiguityFinding, MergeSpans } from "../../api/ambiguity";
import { ApiRequestError } from "../../api/client";
import { useAuth } from "../../auth/AuthContext";
import { Modal } from "../common/Modal";
import { useMergeFinding, useMergePreview } from "../../state/hooks/useAmbiguity";
import { useCheckoutEmitter } from "../../state/hooks/useEmitterCheckout";
import { SeverityBadge } from "./SeverityBadge";
import { num, rangeText } from "./ambiguityText";

function message(err: unknown) {
  return err instanceof ApiRequestError ? err.message : "Something went wrong";
}

function spanText(s: MergeSpans, key: "rf" | "pw" | "pri") {
  if (key === "pri" && !s.pri) return s.stagger ? s.stagger.map(num).join(", ") : "—";
  return rangeText(s[key] ?? null);
}

/** Keep one of the two Modes, widened to cover both; delete the other. Shows
 * what would change first — including new overlaps with other Modes — and
 * needs the Emitter checked out. */
export function MergeDialog({ finding, runId, onClose }: { finding: AmbiguityFinding; runId: string; onClose: () => void }) {
  const { user } = useAuth();
  const [keep, setKeep] = useState<"a" | "b">("a");
  const preview = useMergePreview(finding.id, keep);
  const merge = useMergeFinding(runId);
  const plan = preview.data;
  const emitterId = finding.details.mode_a.emitter_id;
  const checkout = useCheckoutEmitter(emitterId);
  const holder = plan?.emitter.checked_out_by_id ?? null;
  const mine = !!user && holder === user.id;
  const done = merge.isSuccess;

  const sides = { a: finding.details.mode_a, b: finding.details.mode_b };

  return (
    <Modal title="Merge two Modes" onClose={onClose} wide>
      {done ? (
        <div className="merge-done">
          <p>
            Merged: <strong>{plan?.kept.name}</strong> now covers both, and <strong>{plan?.removed.name}</strong> is deleted.
          </p>
          <p className="hint-text">
            This is in {plan?.emitter.name}&apos;s unsaved changes. <Link to={`/emitters/${emitterId}`}>Save a version there</Link>,
            then run the check again to see the result.
          </p>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
      ) : (
        <>
          <fieldset className="merge-keep">
            <legend>Keep which one?</legend>
            {(["a", "b"] as const).map((k) => (
              <label key={k} className={keep === k ? "merge-keep-option selected" : "merge-keep-option"}>
                <input type="radio" name="keep" checked={keep === k} onChange={() => setKeep(k)} />
                <span>
                  <strong className={k === "a" ? "side-a-text" : "side-b-text"}>{sides[k].mode_name}</strong>
                  <span className="hint-text"> · source {sides[k].source_name}</span>
                </span>
              </label>
            ))}
          </fieldset>

          {preview.isLoading && <p className="hint-text">Working out what would change…</p>}
          {preview.isError && <p className="error-text">{message(preview.error)}</p>}

          {plan && (
            <>
              <table className="merge-table">
                <thead>
                  <tr>
                    <th />
                    <th>{plan.kept.name} now</th>
                    <th>{plan.removed.name}</th>
                    <th>{plan.kept.name} after</th>
                  </tr>
                </thead>
                <tbody>
                  {(["rf", "pri", "pw"] as const).map((k) =>
                    k === "pri" && !plan.kept.before.pri && !plan.kept.before.stagger ? null : (
                      <tr key={k}>
                        <th>{k.toUpperCase()}</th>
                        <td>{spanText(plan.kept.before, k)}</td>
                        <td>{spanText(plan.removed.spans, k)}</td>
                        <td className={spanText(plan.kept.after, k) !== spanText(plan.kept.before, k) ? "merge-changed" : undefined}>
                          {spanText(plan.kept.after, k)}
                        </td>
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
              <p className="hint-text">
                Ranges include their ± margins; the kept Mode takes the wider margin of the two. Its notes record the merge
                and keep {plan.removed.name}&apos;s notes.
              </p>
              <ul className="merge-consequences">
                <li>
                  <strong>{plan.removed.name}</strong> is deleted.
                </li>
                {plan.links_moved.test_records + plan.links_moved.test_record_lines + plan.links_moved.test_lines > 0 && (
                  <li>
                    Its test history moves to {plan.kept.name}:{" "}
                    {[
                      plan.links_moved.test_records && `${plan.links_moved.test_records} test record(s)`,
                      plan.links_moved.test_record_lines && `${plan.links_moved.test_record_lines} test line result(s)`,
                      plan.links_moved.test_lines && `${plan.links_moved.test_lines} SIM test line(s)`,
                    ]
                      .filter(Boolean)
                      .join(", ")}
                    .
                  </li>
                )}
                {plan.links_moved.intercept_entries > 0 && (
                  <li>
                    {plan.links_moved.intercept_entries} intercept entr{plan.links_moved.intercept_entries === 1 ? "y it was" : "ies it was"} made from
                    now point{plan.links_moved.intercept_entries === 1 ? "s" : ""} to {plan.kept.name}.
                  </li>
                )}
              </ul>
              {plan.new_overlaps.length > 0 ? (
                <div className="merge-warning">
                  <strong>Wider ranges, more overlap:</strong> {plan.kept.name} would overlap these Modes more than now —
                  <ul>
                    {plan.new_overlaps.map((o) => (
                      <li key={o.mode_id}>
                        {o.mode_name}: {o.before === "none" ? "no overlap" : <SeverityBadge severity={o.before} />} →{" "}
                        <SeverityBadge severity={o.after} />
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="hint-text">No new or worse overlap with {plan.emitter.name}&apos;s other Modes.</p>
              )}

              <div className="merge-footer">
                {!holder && (
                  <>
                    <span>{plan.emitter.name} isn&apos;t being edited — a merge changes its Modes.</span>
                    <button
                      type="button"
                      className="start-editing-button"
                      disabled={checkout.isPending}
                      onClick={() => checkout.mutate(undefined, { onSuccess: () => void preview.refetch() })}
                    >
                      ✎ Start editing {plan.emitter.name}
                    </button>
                  </>
                )}
                {holder && !mine && <span className="error-text">{plan.emitter.name} is being edited by someone else.</span>}
                {mine && (
                  <button
                    type="button"
                    className="danger-button"
                    disabled={merge.isPending}
                    onClick={() => merge.mutate({ findingId: finding.id, keep })}
                  >
                    {merge.isPending ? "Merging…" : `Merge into ${plan.kept.name}`}
                  </button>
                )}
                <button type="button" className="link-button" onClick={onClose}>
                  Cancel
                </button>
              </div>
              {(merge.isError || checkout.isError) && <p className="error-text">{message(merge.error ?? checkout.error)}</p>}
            </>
          )}
        </>
      )}
    </Modal>
  );
}
