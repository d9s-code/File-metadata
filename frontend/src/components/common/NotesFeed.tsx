import { useState } from "react";
import type { EmitterNote, SourceNote } from "../../types/domain";
import { RequireRole } from "../../auth/RequireAuth";
import { useConfirmDialog } from "./ConfirmDialog";
import { ApiRequestError } from "../../api/client";

type NoteEntry = EmitterNote | SourceNote;

/** Append-only analyst-commentary feed, shared by the Emitter and Source
 * editor views. Newest entry first; adding never touches an earlier entry —
 * this is the replacement for the old single free-text `notes` field, which
 * a later save silently overwrote. */
export function NotesFeed({
  notes,
  isLoading,
  placeholder,
  onAdd,
  isAdding,
  onDelete,
}: {
  notes: NoteEntry[] | undefined;
  isLoading: boolean;
  placeholder: string;
  onAdd: (body: string) => Promise<unknown>;
  isAdding: boolean;
  onDelete: (noteId: string) => Promise<unknown>;
}) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const { confirmDelete, dialog } = useConfirmDialog();

  const hiddenCount = notes ? Math.max(notes.length - 1, 0) : 0;
  const visibleNotes = showAll ? notes : notes?.slice(0, 1);

  async function handleAdd() {
    if (!draft.trim()) return;
    setError(null);
    try {
      await onAdd(draft.trim());
      setDraft("");
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Failed to save note");
    }
  }

  async function handleDelete(noteId: string) {
    if (!(await confirmDelete("Delete this note? This cannot be undone."))) return;
    try {
      await onDelete(noteId);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Failed to delete note");
    }
  }

  return (
    <div className="notes-feed">
      {isLoading ? (
        <p className="hint-text">Loading notes…</p>
      ) : !notes || notes.length === 0 ? (
        <p className="hint-text">No notes yet.</p>
      ) : (
        <>
          <ul className="notes-feed-list">
            {(visibleNotes ?? []).map((n) => (
              <li key={n.id} className="notes-feed-entry">
                <div className="notes-feed-meta">
                  <span>{n.author_username ?? "system"}</span>
                  <span className="hint-text">{new Date(n.created_at).toLocaleString()}</span>
                  <RequireRole minimum="editor">
                    <button type="button" className="link-button link-button-danger" onClick={() => void handleDelete(n.id)}>
                      Delete
                    </button>
                  </RequireRole>
                </div>
                <p style={{ whiteSpace: "pre-wrap", margin: 0 }}>{n.body}</p>
              </li>
            ))}
          </ul>
          {hiddenCount > 0 && (
            <button type="button" className="link-button" onClick={() => setShowAll((v) => !v)}>
              {showAll ? "Show only the most recent" : `Show ${hiddenCount} earlier note${hiddenCount === 1 ? "" : "s"}`}
            </button>
          )}
        </>
      )}
      <RequireRole minimum="editor">
        <div className="notes-feed-add">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={placeholder}
            rows={2}
            style={{ width: "100%" }}
          />
          <button
            type="button"
            className="button secondary small"
            onClick={() => void handleAdd()}
            disabled={isAdding || !draft.trim()}
          >
            {isAdding ? "Adding..." : "Add note"}
          </button>
        </div>
      </RequireRole>
      {error && <div className="error-text">{error}</div>}
      {dialog}
    </div>
  );
}
