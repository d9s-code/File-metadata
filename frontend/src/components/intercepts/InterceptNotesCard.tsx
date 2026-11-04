import { useEffect, useState } from "react";
import { ApiRequestError } from "../../api/client";
import { useUpdateIntercept } from "../../state/hooks/useIntercepts";

function draftKey(interceptId: string) {
  return `intercept-notes-draft:${interceptId}`;
}
function readDraft(interceptId: string): string | null {
  try {
    return localStorage.getItem(draftKey(interceptId));
  } catch {
    return null;
  }
}
function writeDraft(interceptId: string, text: string | null) {
  try {
    if (text == null) localStorage.removeItem(draftKey(interceptId));
    else localStorage.setItem(draftKey(interceptId), text);
  } catch {
    // Not kept between visits — fine.
  }
}

/** The Intercept's own Notes: one long text about the whole Intercept — what
 * it is thought to be, what to check — kept apart from the dated comment feed.
 * Unsaved changes are kept on this computer until saved or discarded. */
export function InterceptNotesCard({
  interceptId,
  notes,
  canEdit,
}: {
  interceptId: string;
  notes: string | null;
  canEdit: boolean;
}) {
  const update = useUpdateIntercept();
  const saved = notes ?? "";
  const [text, setText] = useState(() => readDraft(interceptId) ?? saved);
  const [editing, setEditing] = useState(() => readDraft(interceptId) != null);
  const [error, setError] = useState<string | null>(null);
  const dirty = text !== saved;

  // Another visit (or someone else) saved: follow it unless changes are being made here.
  useEffect(() => {
    if (!editing) setText(saved);
  }, [saved, editing]);

  function change(next: string) {
    setText(next);
    writeDraft(interceptId, next === saved ? null : next);
  }
  function discard() {
    writeDraft(interceptId, null);
    setText(saved);
    setEditing(false);
    setError(null);
  }
  async function save() {
    setError(null);
    try {
      await update.mutateAsync({ interceptId, input: { analysis_notes: text.trim() ? text : null } });
      writeDraft(interceptId, null);
      setEditing(false);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Couldn't save the notes");
    }
  }

  if (!editing && !saved && !canEdit) return null;

  return (
    <section className="card intercept-notes">
      <div className="intercept-notes-head">
        <h3>Notes</h3>
        {canEdit && !editing && (
          <button type="button" className="button secondary small" onClick={() => setEditing(true)}>
            {saved ? "Edit" : "+ Add notes"}
          </button>
        )}
      </div>
      {editing ? (
        <>
          <textarea
            className="intercept-notes-text"
            value={text}
            autoFocus
            rows={Math.min(24, Math.max(6, text.split("\n").length + 1))}
            placeholder="What this Intercept is thought to be, what fits and what doesn't, what to check next…"
            aria-label="Intercept notes"
            onChange={(e) => change(e.target.value)}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === "s") {
                e.preventDefault();
                if (dirty) void save();
              }
              if (e.key === "Escape" && !dirty) setEditing(false);
            }}
          />
          <div className="intercept-notes-actions">
            <button type="button" className="button primary small" disabled={!dirty || update.isPending} onClick={() => void save()}>
              {update.isPending ? "Saving…" : "Save"}
            </button>
            <button type="button" className="button secondary small" onClick={discard}>
              {dirty ? "Discard changes" : "Close"}
            </button>
            <span className="hint-text">
              {dirty ? "Not saved yet — kept on this computer until you save." : "Ctrl+S saves."}
            </span>
          </div>
          {error && <div className="error-text">{error}</div>}
        </>
      ) : saved ? (
        <div className="intercept-notes-body">{saved}</div>
      ) : (
        <p className="hint-text">
          One place for your thinking about the Intercept as a whole. Dated remarks go under Comments.
        </p>
      )}
    </section>
  );
}
