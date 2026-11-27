import { useState, type FormEvent } from "react";
import { Modal } from "../common/Modal";
import { formatDateTime } from "../common/dates";
import { useAuth } from "../../auth/AuthContext";
import { useHasRole } from "../../auth/RequireAuth";
import { ApiRequestError } from "../../api/client";
import type { PlanComment } from "../../api/operationalModes";
import { usePlanCommentActions } from "../../state/hooks/useOperationalModes";

/** The comments on one operational mode (or, with none, on the whole plan): open ones first. */
export function threadsFor(comments: PlanComment[], opId: string | null): { top: PlanComment; replies: PlanComment[] }[] {
  const top = comments.filter((c) => !c.parent_id && (c.operational_mode_id ?? null) === opId);
  const out = top.map((t) => ({ top: t, replies: comments.filter((c) => c.parent_id === t.id) }));
  return out.sort((a, b) => Number(a.top.resolved) - Number(b.top.resolved) || a.top.created_at.localeCompare(b.top.created_at));
}

/** How many comments it has, and how many threads are open. */
export function commentCounts(comments: PlanComment[], opId: string | null) {
  const threads = threadsFor(comments, opId);
  return { total: threads.reduce((n, t) => n + 1 + t.replies.length, 0), open: threads.filter((t) => !t.top.resolved).length };
}

function CommentBody({ c, emitterId, onReply }: { c: PlanComment; emitterId: string; onReply?: () => void }) {
  const { user } = useAuth();
  const canEdit = useHasRole("editor");
  const { update, remove } = usePlanCommentActions(emitterId);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(c.body);
  const mine = !!user && c.author_id === user.id;
  return (
    <div className="plan-comment">
      <div className="plan-comment-head">
        <strong>{c.author_username ?? "—"}</strong>
        <span className="hint-text">
          {formatDateTime(c.created_at)}
          {c.edited_at ? " · edited" : ""}
        </span>
        {c.resolved && <span className="status-badge plan-resolved">Resolved{c.resolved_by_username ? ` by ${c.resolved_by_username}` : ""}</span>}
      </div>
      {editing ? (
        <div className="plan-comment-edit">
          <textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} aria-label="Edit comment" />
          <button
            type="button"
            className="button primary small"
            disabled={!text.trim() || update.isPending}
            onClick={() => void update.mutateAsync({ id: c.id, input: { body: text } }).then(() => setEditing(false))}
          >
            Save
          </button>
          <button type="button" className="button secondary small" onClick={() => setEditing(false)}>
            Cancel
          </button>
        </div>
      ) : (
        <p className="plan-comment-text">{c.body}</p>
      )}
      {canEdit && !editing && (
        <div className="plan-comment-actions">
          {onReply && (
            <button type="button" className="link-button" onClick={onReply}>
              Reply
            </button>
          )}
          {!c.parent_id && (
            <button type="button" className="link-button" onClick={() => void update.mutateAsync({ id: c.id, input: { resolved: !c.resolved } })}>
              {c.resolved ? "Reopen" : "Resolve"}
            </button>
          )}
          {mine && (
            <button type="button" className="link-button" onClick={() => setEditing(true)}>
              Edit
            </button>
          )}
          {(mine || user?.role === "admin") && (
            <button type="button" className="link-button danger" onClick={() => void remove.mutateAsync(c.id)}>
              Delete
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Comments on an operational mode, or on the whole plan: threads with
 * replies, each open or resolved. Any editor can comment — the Emitter
 * needn't be held. */
export function PlanComments({
  emitterId,
  opId,
  title,
  comments,
  onClose,
}: {
  emitterId: string;
  opId: string | null;
  title: string;
  comments: PlanComment[];
  onClose: () => void;
}) {
  const canEdit = useHasRole("editor");
  const { add } = usePlanCommentActions(emitterId);
  const [text, setText] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [error, setError] = useState<string | null>(null);
  const threads = threadsFor(comments, opId);

  async function submit(e: FormEvent, body: string, parentId: string | null) {
    e.preventDefault();
    setError(null);
    try {
      await add.mutateAsync({ body, operational_mode_id: parentId ? undefined : opId, parent_id: parentId });
      if (parentId) {
        setReply("");
        setReplyTo(null);
      } else setText("");
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Couldn't add it");
    }
  }

  return (
    <Modal title={title} onClose={onClose} wide>
      <div className="plan-comments">
        {!threads.length && <p className="hint-text">No comments yet.</p>}
        {threads.map(({ top, replies }) => (
          <div key={top.id} className={top.resolved ? "plan-thread resolved" : "plan-thread"}>
            <CommentBody c={top} emitterId={emitterId} onReply={() => setReplyTo(top.id)} />
            {replies.map((r) => (
              <div key={r.id} className="plan-reply">
                <CommentBody c={r} emitterId={emitterId} />
              </div>
            ))}
            {replyTo === top.id && (
              <form className="plan-reply plan-comment-new" onSubmit={(e) => void submit(e, reply, top.id)}>
                <textarea rows={2} autoFocus value={reply} placeholder="Reply…" aria-label="Reply" onChange={(e) => setReply(e.target.value)} />
                <button type="submit" className="button primary small" disabled={!reply.trim() || add.isPending}>
                  Reply
                </button>
                <button type="button" className="button secondary small" onClick={() => setReplyTo(null)}>
                  Cancel
                </button>
              </form>
            )}
          </div>
        ))}
        {canEdit && (
          <form className="plan-comment-new" onSubmit={(e) => void submit(e, text, null)}>
            <textarea
              rows={3}
              value={text}
              aria-label="New comment"
              placeholder="A question, a finding, a source to check…"
              onChange={(e) => setText(e.target.value)}
            />
            <button type="submit" className="button primary small" disabled={!text.trim() || add.isPending}>
              Comment
            </button>
          </form>
        )}
        {error && <p className="error-text">{error}</p>}
      </div>
    </Modal>
  );
}
