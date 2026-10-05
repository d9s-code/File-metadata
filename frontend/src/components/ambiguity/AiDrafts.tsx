import type { ReactNode } from "react";
import type { AiStamp, AmbiguityFinding, AmbiguityRun } from "../../api/ambiguity";
import { ApiRequestError } from "../../api/client";
import { RequireRole } from "../../auth/RequireAuth";
import { useExplainFinding, useReviewFinding, useSummariseRun } from "../../state/hooks/useAmbiguity";

function message(err: unknown) {
  return err instanceof ApiRequestError ? err.message : "The language model couldn't be asked";
}

/** The frame every AI answer sits in: plainly a draft, with who asked and
 * which model answered, and any number it gave that wasn't in its input. */
function DraftFrame({
  stamp,
  onAgain,
  asking,
  children,
}: {
  stamp: AiStamp;
  onAgain: () => void;
  asking: boolean;
  children: ReactNode;
}) {
  return (
    <div className="ai-draft">
      <div className="ai-draft-head">
        <span className="ai-draft-tag">AI draft</span>
        <span className="hint-text">
          {stamp.model} · asked by {stamp.generated_by ?? "someone"} {new Date(stamp.generated_at).toLocaleString()} ·{" "}
          {stamp.seconds}s
        </span>
        <button type="button" className="link-button" disabled={asking} onClick={onAgain}>
          {asking ? "Asking…" : "Ask again"}
        </button>
      </div>
      {stamp.unverified_numbers.length > 0 && (
        <p className="ai-draft-warning" role="note">
          ⚠ Not in the data it was given — check before relying on:{" "}
          <strong>{stamp.unverified_numbers.join(", ")}</strong>
        </p>
      )}
      {children}
      <p className="hint-text ai-draft-foot">
        Written by a language model from the computed overlap above. It can be wrong — check it against the numbers,
        and re-run the check after any change.
      </p>
    </div>
  );
}

/** For the selected finding: the model's explanation and recommendation, or
 * the button to ask for it. An Editor can acknowledge the finding with the
 * recommendation as its note. */
export function AiFindingExplanation({ finding, runId }: { finding: AmbiguityFinding; runId: string }) {
  const explain = useExplainFinding(runId);
  const review = useReviewFinding(runId);
  const ai = finding.ai_explanation;
  const asking = explain.isPending && explain.variables?.findingId === finding.id;

  if (!ai) {
    return (
      <div className="ai-ask">
        <button
          type="button"
          disabled={asking}
          onClick={() => explain.mutate({ findingId: finding.id })}
          title="Sends this pair's values and computed overlap to the language model"
        >
          {asking ? "Asking the model…" : "✦ Explain with AI"}
        </button>
        <span className="hint-text">
          {asking
            ? "This can take up to a minute."
            : "Why these two can't be told apart, and what could be done — a draft for you to check."}
        </span>
        {explain.isError && explain.variables?.findingId === finding.id && (
          <span className="error-text">{message(explain.error)}</span>
        )}
      </div>
    );
  }

  return (
    <DraftFrame stamp={ai} asking={asking} onAgain={() => explain.mutate({ findingId: finding.id, refresh: true })}>
      <p>{ai.explanation}</p>
      <p>
        <strong>What tells them apart:</strong> {ai.distinguishing}
      </p>
      <p>
        <strong>Suggested: {ai.recommendation_label}.</strong> {ai.recommendation_detail}{" "}
        <span className="hint-text">(confidence: {ai.confidence})</span>
      </p>
      {explain.isError && <p className="error-text">{message(explain.error)}</p>}
      {!finding.reviewed_at && (
        <RequireRole minimum="editor">
          <button
            type="button"
            className="link-button"
            disabled={review.isPending}
            onClick={() =>
              review.mutate({
                findingId: finding.id,
                note: `AI suggestion (${ai.model}): ${ai.recommendation_label} — ${ai.recommendation_detail}`,
              })
            }
          >
            Acknowledge, with this suggestion as the note
          </button>
        </RequireRole>
      )}
    </DraftFrame>
  );
}

/** For the whole run: the model's overview of the findings, or the button to
 * ask for it. */
export function AiRunSummary({ run }: { run: AmbiguityRun }) {
  const summarise = useSummariseRun(run.id);
  const ai = run.ai_summary;

  return (
    <div className="card">
      <h4>AI overview</h4>
      {!ai ? (
        <div className="ai-ask">
          <button type="button" disabled={summarise.isPending} onClick={() => summarise.mutate(false)}>
            {summarise.isPending ? "Asking the model…" : "✦ Summarise with AI"}
          </button>
          <span className="hint-text">
            {summarise.isPending
              ? "This can take up to a minute."
              : "Gives the model the counts and the most serious findings — already computed — and asks where to start."}
          </span>
          {summarise.isError && <span className="error-text">{message(summarise.error)}</span>}
        </div>
      ) : (
        <DraftFrame stamp={ai} asking={summarise.isPending} onAgain={() => summarise.mutate(true)}>
          <p>{ai.overview}</p>
          {ai.priorities.length > 0 && (
            <>
              <strong>Look at first</strong>
              <ol className="ai-draft-list">
                {ai.priorities.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ol>
            </>
          )}
          {ai.patterns.length > 0 && (
            <>
              <strong>Patterns</strong>
              <ul className="ai-draft-list">
                {ai.patterns.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            </>
          )}
          {ai.findings_total > ai.findings_given && (
            <p className="hint-text">
              The model was given the {ai.findings_given} most serious of {ai.findings_total} findings, plus the counts.
            </p>
          )}
          {summarise.isError && <p className="error-text">{message(summarise.error)}</p>}
        </DraftFrame>
      )}
    </div>
  );
}
