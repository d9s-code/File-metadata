import { Fragment, type ReactNode } from "react";
import type { AiSource, AiStamp, AmbiguityFinding, AmbiguityRun } from "../../api/ambiguity";
import { ApiRequestError } from "../../api/client";
import { RequireRole } from "../../auth/RequireAuth";
import {
  useAiStatus,
  useExplainFinding,
  useReviewFinding,
  useSummariseRun,
  useSyncDocumentation,
} from "../../state/hooks/useAmbiguity";
import { relativeTime } from "../common/backupFormat";
import { SeverityBadge } from "./SeverityBadge";

function message(err: unknown) {
  return err instanceof ApiRequestError ? err.message : "The language model couldn't be asked";
}

/** The model's text with its [S1] citations as links to that section in
 * Outline — or marked, if it cites a section it wasn't given. */
export function Cited({ text, sources }: { text: string; sources?: AiSource[] }) {
  const byRef = new Map((sources ?? []).map((s) => [s.ref, s]));
  return (
    <>
      {text.split(/(\[S\d+\])/).map((part, i) => {
        const ref = /^\[(S\d+)\]$/.exec(part)?.[1];
        if (!ref) return <Fragment key={i}>{part}</Fragment>;
        const source = byRef.get(ref);
        return source ? (
          <a key={i} className="ai-cite" href={source.url} target="_blank" rel="noreferrer" title={source.path}>
            {ref}
          </a>
        ) : (
          <span key={i} className="ai-cite ai-cite-unknown" title="Not a section it was given">
            {ref}
          </span>
        );
      })}
    </>
  );
}

/** Which documentation the model was given, which it cited, and any
 * citation of a section it wasn't given. */
function SourcesList({ stamp }: { stamp: AiStamp }) {
  if (!stamp.documentation) return null; // none set up, or a draft from before
  const sources = stamp.sources ?? [];
  const cited = sources.filter((s) => s.cited);
  const others = sources.filter((s) => !s.cited);
  const label = stamp.documentation.label ?? "the documentation";
  const item = (s: AiSource) => (
    <li key={s.ref}>
      <span className="ai-cite">{s.ref}</span>{" "}
      <a href={s.url} target="_blank" rel="noreferrer">
        {s.path}
      </a>
    </li>
  );
  return (
    <div className="ai-sources">
      {sources.length === 0 ? (
        <p className="hint-text">Nothing in {label} matched this question — answered from the data alone.</p>
      ) : (
        <>
          <strong>Documentation cited</strong>
          {cited.length === 0 ? (
            <span className="hint-text"> — none of the {sources.length} sections it was given.</span>
          ) : (
            <ul className="ai-sources-list">{cited.map(item)}</ul>
          )}
          {others.length > 0 && (
            <details>
              <summary className="hint-text">Also given, not cited ({others.length})</summary>
              <ul className="ai-sources-list">{others.map(item)}</ul>
            </details>
          )}
        </>
      )}
      {(stamp.unknown_citations ?? []).length > 0 && (
        <p className="ai-draft-warning" role="note">
          ⚠ Cites <strong>{stamp.unknown_citations!.join(", ")}</strong>, which it wasn&apos;t given — treat what it
          says there as unsupported.
        </p>
      )}
    </div>
  );
}

/** What the model is given as background: the copy of the Outline
 * documentation, how fresh it is, and (for an Admin) Sync now. */
export function DocumentationLine() {
  const doc = useAiStatus().data?.documentation;
  const sync = useSyncDocumentation();
  if (!doc) return null;
  return (
    <p className="hint-text ai-docs-line">
      {doc.synced_at ? (
        <>
          Background: {doc.label} — {doc.sections} sections ({doc.tokens < 1000 ? `${doc.tokens} tokens` : `about ${Math.round(doc.tokens / 1000)}k tokens`}), copied{" "}
          {relativeTime(doc.synced_at)}. The sections that match each question go with it.
        </>
      ) : (
        <>Background: the documentation in Outline — not copied yet; it&apos;s copied on the first question.</>
      )}
      {doc.error && (
        <span className="error-text">
          {" "}
          Last refresh failed{doc.tried_at ? ` ${relativeTime(doc.tried_at)}` : ""}: {doc.error}
        </span>
      )}{" "}
      <RequireRole minimum="admin">
        <button type="button" className="link-button" disabled={sync.isPending} onClick={() => sync.mutate()}>
          {sync.isPending ? "Syncing…" : "Sync now"}
        </button>
        {sync.isError && <span className="error-text"> {message(sync.error)}</span>}
      </RequireRole>
    </p>
  );
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
      <SourcesList stamp={stamp} />
      <p className="hint-text ai-draft-foot">
        Written by a language model from the computed overlap above
        {(stamp.sources ?? []).length > 0 ? " and the documentation sections listed" : ""}. It can be wrong — check it
        against the numbers, and re-run the check after any change.
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
      <p>
        <Cited text={ai.explanation} sources={ai.sources} />
      </p>
      <p>
        <strong>What tells them apart:</strong> <Cited text={ai.distinguishing} sources={ai.sources} />
      </p>
      <p>
        <strong>Suggested: {ai.recommendation_label}.</strong>{" "}
        <Cited text={ai.recommendation_detail} sources={ai.sources} />{" "}
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
                note: `AI suggestion (${ai.model}): ${ai.recommendation_label} — ${ai.recommendation_detail.replace(/\s*\[S\d+\]/g, "")}`,
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
export function AiRunSummary({
  run,
  onSelectFinding,
}: {
  run: AmbiguityRun;
  /** Opens a finding the summary lists. */
  onSelectFinding?: (findingId: string) => void;
}) {
  const summarise = useSummariseRun(run.id);
  const ai = run.ai_summary;

  return (
    <div className="card">
      <h4>AI overview</h4>
      <DocumentationLine />
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
          <p className="ai-verdict">
            <Cited text={ai.verdict ?? ai.overview ?? ""} sources={ai.sources} />
          </p>
          {ai.priorities.length > 0 && (
            <table className="ai-priorities">
              <thead>
                <tr>
                  <th>Look at first</th>
                  <th>Severity</th>
                  <th>Why</th>
                  <th>Suggested</th>
                </tr>
              </thead>
              <tbody>
                {ai.priorities.map((p, i) =>
                  typeof p === "string" ? (
                    <tr key={i}>
                      <td colSpan={4}>
                        <Cited text={p} sources={ai.sources} />
                      </td>
                    </tr>
                  ) : (
                    <tr
                      key={p.finding_id}
                      className={onSelectFinding ? "ai-priority-row" : undefined}
                      onClick={onSelectFinding ? () => onSelectFinding(p.finding_id) : undefined}
                      title={onSelectFinding ? "Open this finding" : undefined}
                    >
                      <td>{p.pair}</td>
                      <td>
                        <SeverityBadge severity={p.severity} />
                      </td>
                      <td>
                        <Cited text={p.why} sources={ai.sources} />
                      </td>
                      <td>{p.action_label}</td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          )}
          {ai.patterns.length > 0 && (
            <p className="ai-patterns">
              <strong>Patterns:</strong>{" "}
              {ai.patterns.map((p, i) => (
                <Fragment key={i}>
                  {i > 0 && " · "}
                  <Cited text={p} sources={ai.sources} />
                </Fragment>
              ))}
            </p>
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
