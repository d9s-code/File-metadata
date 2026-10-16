import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { emittersApi, type EmitterBulkInput, type EmitterBulkResult } from "../../api/emitters";
import { ApiRequestError } from "../../api/client";
import { usePeople } from "../../state/hooks/useTasks";
import { usePlatforms } from "../../state/hooks/usePlatforms";
import { useAuth } from "../../auth/AuthContext";
import { useStatuses } from "../../state/hooks/useStatuses";

type Action = "assign" | "status" | "pin" | "release";

/** What to do with the Emitters ticked in the list: assign them, move their
 * status, pin their latest saved version into a Platform, or release their
 * edit locks. Each Emitter follows the usual rules; any that can't are
 * listed with the reason. */
export function EmitterBulkBar({ selected, onClear }: { selected: string[]; onClear: () => void }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { data: people } = usePeople();
  const { data: platforms } = usePlatforms();
  const [action, setAction] = useState<Action>("assign");
  const [assignee, setAssignee] = useState("");
  const statuses = useStatuses("emitter");
  const [status, setStatus] = useState("in_review");
  // Move even where the new status's milestones aren't all met.
  const [evenUnmet, setEvenUnmet] = useState(false);
  const [note, setNote] = useState("");
  const [platformId, setPlatformId] = useState("");
  const [result, setResult] = useState<EmitterBulkResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = useMutation({
    mutationFn: (input: EmitterBulkInput) => emittersApi.bulk(input),
    onSuccess: (r) => {
      setResult(r);
      qc.invalidateQueries({ queryKey: ["emitters"] });
      qc.invalidateQueries({ queryKey: ["platformLinks"] });
    },
  });

  const editors = (people ?? []).filter((p) => p.role !== "viewer");
  const needsNote = action === "status" && !!statuses.byKey[status]?.requires_note;
  const ready =
    selected.length > 0 &&
    (action !== "pin" || !!platformId) &&
    (!needsNote || note.trim().length > 0);

  async function apply() {
    setError(null);
    setResult(null);
    try {
      await run.mutateAsync({
        emitter_ids: selected,
        action,
        ...(action === "assign" ? { assignee_id: assignee || null } : {}),
        ...(action === "status"
          ? { new_status: status, note: note.trim() || undefined, confirm_unmet: evenUnmet }
          : {}),
        ...(action === "pin" ? { platform_id: platformId } : {}),
      });
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Couldn't apply it");
    }
  }

  const skipped = result?.results.filter((r) => !r.ok) ?? [];
  return (
    <div className="card emitter-bulk-bar">
      <div className="emitter-bulk-row">
        <strong>
          {selected.length} selected
        </strong>
        <select value={action} onChange={(e) => setAction(e.target.value as Action)} aria-label="Action">
          <option value="assign">Assign to…</option>
          <option value="status">Move status to…</option>
          <option value="pin">Pin latest saved version into…</option>
          <option value="release">Release edit locks</option>
        </select>
        {action === "assign" && (
          <select value={assignee} onChange={(e) => setAssignee(e.target.value)} aria-label="Assign to">
            <option value="">Nobody</option>
            {editors.map((p) => (
              <option key={p.id} value={p.id}>
                {p.id === user?.id ? `${p.username} (you)` : p.username}
              </option>
            ))}
          </select>
        )}
        {action === "status" && (
          <>
            <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="New status">
              {statuses.list.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
            <label className="inline-label" title="Otherwise those with milestones not met are skipped and listed">
              <input type="checkbox" checked={evenUnmet} onChange={(e) => setEvenUnmet(e.target.checked)} />
              even if milestones aren&apos;t met
            </label>
          </>
        )}
        {needsNote && (
          <input
            className="emitter-bulk-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={`${statuses.byKey[status]?.note_prompt ?? "Note"} (required)`}
            aria-label="Note"
          />
        )}
        {action === "pin" && (
          <select value={platformId} onChange={(e) => setPlatformId(e.target.value)} aria-label="Platform">
            <option value="">Choose a Platform…</option>
            {(platforms ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        )}
        <button type="button" disabled={!ready || run.isPending} onClick={() => void apply()}>
          {run.isPending ? "Working…" : "Apply"}
        </button>
        {selected.length === 2 && (
          <Link className="link-as-button" to={`/emitters/compare?a=${selected[0]}&b=${selected[1]}`}>
            Compare these two
          </Link>
        )}
        <button type="button" className="link-button" onClick={onClear}>
          Clear selection
        </button>
      </div>
      {action === "release" && (
        <p className="hint-text">
          Releases the edit lock without discarding anything. You can release your own; an Admin can release anyone&apos;s.
        </p>
      )}
      {error && <p className="error-text">{error}</p>}
      {result && (
        <div className="emitter-bulk-result">
          <span>
            {result.done} done{result.skipped ? ` · ${result.skipped} skipped` : ""}.
          </span>
          {skipped.length > 0 && (
            <ul>
              {skipped.map((r) => (
                <li key={r.id}>
                  <strong>{r.name}</strong> — {r.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
