import { useState } from "react";
import { ApiRequestError } from "../../api/client";
import type { Mdf } from "../../api/mdfs";
import type { LogKind, MdfGoal } from "../../api/mdfPlan";
import type { MdfVersionSummary } from "../../api/mdfVersions";
import { useMdfGoals, useMdfLog, useMdfPlanMutations } from "../../state/hooks/useMdfPlan";
import { useUpdateMdf } from "../../state/hooks/useMdfs";
import { useAuth } from "../../auth/AuthContext";
import { formatDate, formatDateTime } from "../common/dates";
import { DateInput } from "../common/DateInput";
import { LoadingState } from "../common/LoadingState";
import { MenuButton } from "../common/MenuButton";
import { useConfirmDialog } from "../common/ConfirmDialog";
import { SummaryPanel } from "./MdfSummary";

/** "in 12 days", "today", "3 days overdue" — from today to a YYYY-MM-DD date. */
export function dueText(due: string): { text: string; overdue: boolean; soon: boolean } {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(`${due}T00:00:00`);
  const days = Math.round((d.getTime() - today.getTime()) / 86_400_000);
  if (days === 0) return { text: "due today", overdue: false, soon: true };
  if (days > 0) return { text: `in ${days} day${days === 1 ? "" : "s"}`, overdue: false, soon: days <= 7 };
  return { text: `${-days} day${days === -1 ? "" : "s"} overdue`, overdue: true, soon: false };
}

/** Due date and goals, as one line for the MDF's header and the MDFs list. */
export function MdfPlanChips({ mdf, done }: { mdf: Mdf; done?: boolean }) {
  const due = mdf.due_date ? dueText(mdf.due_date) : null;
  return (
    <>
      {mdf.due_date && due && (
        <span
          className={`status-badge mdf-due${due.overdue && !done ? " overdue" : due.soon && !done ? " soon" : ""}`}
          title={`Due ${formatDate(mdf.due_date)}`}
        >
          Due {formatDate(mdf.due_date)}
          {!done && ` · ${due.text}`}
        </span>
      )}
      {mdf.goals_total > 0 && (
        <span className="status-badge mdf-goals-chip" title={`${mdf.goals_done} of ${mdf.goals_total} goals reached`}>
          <span className="mdf-goals-bar" aria-hidden>
            <span style={{ width: `${(100 * mdf.goals_done) / mdf.goals_total}%` }} />
          </span>
          {mdf.goals_done}/{mdf.goals_total} goals
        </span>
      )}
    </>
  );
}

function Goal({
  goal,
  index,
  count,
  canEdit,
  onToggle,
  onMove,
  onReword,
  onDelete,
}: {
  goal: MdfGoal;
  index: number;
  count: number;
  canEdit: boolean;
  onToggle: (goal: MdfGoal, note: string | null) => void;
  onMove: (goal: MdfGoal, by: number) => void;
  onReword: (goal: MdfGoal, text: string) => void;
  onDelete: (goal: MdfGoal) => void;
}) {
  const [noting, setNoting] = useState(false);
  const [note, setNote] = useState("");
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(goal.text);
  const done = !!goal.done_at;
  return (
    <li className={`mdf-goal${done ? " done" : ""}`}>
      <input
        type="checkbox"
        checked={done}
        disabled={!canEdit}
        aria-label={done ? `Reopen: ${goal.text}` : `Mark reached: ${goal.text}`}
        onChange={() => (done ? onToggle(goal, null) : setNoting(true))}
      />
      <div className="mdf-goal-body">
        {editing ? (
          <form
            className="inline-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (text.trim()) onReword(goal, text.trim());
              setEditing(false);
            }}
          >
            <input type="text" value={text} autoFocus maxLength={2000} onChange={(e) => setText(e.target.value)} aria-label="Goal" />
            <button type="submit" className="button primary small">
              Save
            </button>
            <button type="button" className="button secondary small" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </form>
        ) : (
          <span className="mdf-goal-text">{goal.text}</span>
        )}
        {done && (
          <div className="hint-text">
            Reached {formatDateTime(goal.done_at)}
            {goal.done_by_username && ` by ${goal.done_by_username}`}
            {goal.done_note && ` — ${goal.done_note}`}
          </div>
        )}
        {noting && (
          <form
            className="inline-form"
            onSubmit={(e) => {
              e.preventDefault();
              onToggle(goal, note.trim() || null);
              setNoting(false);
              setNote("");
            }}
          >
            <input
              type="text"
              value={note}
              autoFocus
              maxLength={2000}
              placeholder="How it was reached (optional)"
              aria-label="Note on reaching the goal"
              onChange={(e) => setNote(e.target.value)}
            />
            <button type="submit" className="button primary small">
              Mark reached
            </button>
            <button type="button" className="button secondary small" onClick={() => setNoting(false)}>
              Cancel
            </button>
          </form>
        )}
      </div>
      {canEdit && !editing && (
        <MenuButton
          label="⋯"
          className="row-menu-button"
          ariaLabel={`Actions for goal ${goal.text}`}
          items={[
            { label: "Reword", onSelect: () => { setText(goal.text); setEditing(true); } },
            { label: "Move up", onSelect: () => onMove(goal, -1), disabled: index === 0 },
            { label: "Move down", onSelect: () => onMove(goal, 1), disabled: index === count - 1 },
            { label: "Remove", danger: true, onSelect: () => onDelete(goal) },
          ]}
        />
      )}
    </li>
  );
}

/** Release notes for one saved version: shown, or edited in place. */
function ReleaseNotes({
  version,
  canEdit,
  onSave,
}: {
  version: MdfVersionSummary;
  canEdit: boolean;
  onSave: (text: string | null) => Promise<unknown>;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(version.release_notes ?? "");
  const [error, setError] = useState<string | null>(null);
  return (
    <li className="mdf-release-notes">
      <div className="mdf-release-head">
        <strong>v{version.version_number}</strong>
        <span className="hint-text">
          saved {formatDateTime(version.created_at)}
          {version.created_by_username && ` by ${version.created_by_username}`}
          {version.change_summary && ` — ${version.change_summary}`}
        </span>
        {canEdit && !editing && (
          <button type="button" className="link-button" onClick={() => { setText(version.release_notes ?? ""); setEditing(true); }}>
            {version.release_notes ? "Edit" : "+ Write release notes"}
          </button>
        )}
      </div>
      {editing ? (
        <>
          <textarea
            className="mdf-release-text"
            rows={Math.min(16, Math.max(4, text.split("\n").length + 1))}
            value={text}
            autoFocus
            placeholder="What this version brings and anything the receiver should know."
            onChange={(e) => setText(e.target.value)}
          />
          <div className="section-actions">
            <button
              type="button"
              className="button primary small"
              onClick={() =>
                void onSave(text.trim() || null)
                  .then(() => setEditing(false))
                  .catch((err) => setError(err instanceof ApiRequestError ? err.message : "Couldn't save"))
              }
            >
              Save
            </button>
            <button type="button" className="button secondary small" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
          {error && <div className="error-text">{error}</div>}
        </>
      ) : version.release_notes ? (
        <div className="mdf-release-body">{version.release_notes}</div>
      ) : (
        <span className="hint-text">No release notes.</span>
      )}
    </li>
  );
}

/** An MDF's plan: when it's due, the goals to reach, a log of how it's going
 * and how it went out, and the release notes of each saved version. */
export function MdfPlanPanel({
  mdf,
  versions,
  canEdit,
}: {
  mdf: Mdf;
  versions: MdfVersionSummary[];
  canEdit: boolean;
}) {
  const { user } = useAuth();
  const { data: goals, isLoading: goalsLoading } = useMdfGoals(mdf.id);
  const { data: log, isLoading: logLoading } = useMdfLog(mdf.id);
  const m = useMdfPlanMutations(mdf.id);
  const updateMdf = useUpdateMdf();
  const { confirmDelete, dialog } = useConfirmDialog();
  const [newGoal, setNewGoal] = useState("");
  const [logKind, setLogKind] = useState<LogKind>("progress");
  const [logBody, setLogBody] = useState("");
  const [editingDue, setEditingDue] = useState(false);
  const [due, setDue] = useState(mdf.due_date ?? "");
  const [error, setError] = useState<string | null>(null);
  const [summarizing, setSummarizing] = useState(false);
  const fail = (what: string) => (err: unknown) => setError(err instanceof ApiRequestError ? err.message : what);

  const list = goals ?? [];
  const doneCount = list.filter((g) => g.done_at).length;

  function move(goal: MdfGoal, by: number) {
    const ids = list.map((g) => g.id);
    const i = ids.indexOf(goal.id);
    const j = i + by;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    m.reorderGoals.mutate(ids, { onError: fail("Couldn't reorder") });
  }

  return (
    <div className="mdf-plan">
      {error && (
        <div className="error-text" role="alert">
          {error}{" "}
          <button type="button" className="link-button" onClick={() => setError(null)}>
            Dismiss
          </button>
        </div>
      )}
      <section className="card">
        <div className="card-header">
          <h4>Due date</h4>
        </div>
        {editingDue ? (
          <form
            className="inline-form"
            onSubmit={(e) => {
              e.preventDefault();
              updateMdf.mutate(
                { id: mdf.id, input: { due_date: due || null } },
                { onSuccess: () => setEditingDue(false), onError: fail("Couldn't save the due date") },
              );
            }}
          >
            <DateInput value={due} onChange={(e) => setDue(e.target.value)} aria-label="Due date" />
            <button type="submit" className="button primary small" disabled={updateMdf.isPending}>
              Save
            </button>
            {mdf.due_date && (
              <button type="button" className="button secondary small" onClick={() => setDue("")}>
                Clear
              </button>
            )}
            <button type="button" className="button secondary small" onClick={() => setEditingDue(false)}>
              Cancel
            </button>
          </form>
        ) : (
          <p className="mdf-due-line">
            {mdf.due_date ? (
              <>
                <strong>{formatDate(mdf.due_date)}</strong>{" "}
                <span className={dueText(mdf.due_date).overdue ? "error-text" : "hint-text"}>{dueText(mdf.due_date).text}</span>
              </>
            ) : (
              <span className="hint-text">No due date set.</span>
            )}
            {mdf.release_date && <span className="hint-text"> · release date {formatDate(mdf.release_date)}</span>}
            {canEdit && (
              <button type="button" className="link-button" onClick={() => { setDue(mdf.due_date ?? ""); setEditingDue(true); }}>
                {mdf.due_date ? "Change" : "Set a due date"}
              </button>
            )}
          </p>
        )}
      </section>

      <section className="card">
        <div className="card-header">
          <h4>
            Goals <span className="hint-text">{list.length ? `${doneCount} of ${list.length} reached` : ""}</span>
          </h4>
        </div>
        {list.length > 0 && (
          <div className="mdf-goals-progress" aria-hidden>
            <span style={{ width: `${(100 * doneCount) / list.length}%` }} />
          </div>
        )}
        {goalsLoading ? (
          <LoadingState label="Loading goals…" />
        ) : list.length === 0 ? (
          <p className="hint-text">No goals yet — what has to be true before this MDF is ready?</p>
        ) : (
          <ul className="mdf-goals">
            {list.map((g, i) => (
              <Goal
                key={g.id}
                goal={g}
                index={i}
                count={list.length}
                canEdit={canEdit}
                onToggle={(goal, note) =>
                  m.updateGoal.mutate({ id: goal.id, done: !goal.done_at, note }, { onError: fail("Couldn't update the goal") })
                }
                onMove={move}
                onReword={(goal, text) => m.updateGoal.mutate({ id: goal.id, text }, { onError: fail("Couldn't reword the goal") })}
                onDelete={async (goal) => {
                  if (await confirmDelete(`Remove the goal "${goal.text}"?`)) m.deleteGoal.mutate(goal.id, { onError: fail("Couldn't remove the goal") });
                }}
              />
            ))}
          </ul>
        )}
        {canEdit && (
          <form
            className="inline-form mdf-goal-add"
            onSubmit={(e) => {
              e.preventDefault();
              if (!newGoal.trim()) return;
              m.addGoal.mutate(newGoal.trim(), { onSuccess: () => setNewGoal(""), onError: fail("Couldn't add the goal") });
            }}
          >
            <input
              type="text"
              value={newGoal}
              maxLength={2000}
              placeholder="A goal, e.g. 'Every Emitter Operational' or 'Customer sign-off'"
              aria-label="New goal"
              onChange={(e) => setNewGoal(e.target.value)}
            />
            <button type="submit" className="button primary small" disabled={!newGoal.trim() || m.addGoal.isPending}>
              + Add goal
            </button>
          </form>
        )}
      </section>

      {summarizing && <SummaryPanel mdfId={mdf.id} versions={versions} onClose={() => setSummarizing(false)} />}
      <section className="card">
        <div className="card-header">
          <h4>Release notes</h4>
          <span className="section-actions">
            <span className="hint-text">Per saved version — they go into the release notes document.</span>
            <button
              type="button"
              className="button secondary small"
              disabled={versions.length === 0 || summarizing}
              title={versions.length === 0 ? "Save a version first" : "What changed between two versions — and the release notes document"}
              onClick={() => setSummarizing(true)}
            >
              Summarize…
            </button>
          </span>
        </div>
        {versions.length === 0 ? (
          <p className="hint-text">Save a version first — release notes belong to a saved version.</p>
        ) : (
          <ul className="mdf-release-list">
            {[...versions].reverse().map((v) => (
              <ReleaseNotes
                key={v.id}
                version={v}
                canEdit={canEdit}
                onSave={(text) => m.setReleaseNotes.mutateAsync({ version: v.version_number, text })}
              />
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <div className="card-header">
          <h4>
            Progress log <span className="hint-text">{log?.length ?? 0}</span>
          </h4>
          <span className="hint-text">Dated entries on how it's going and how it went out — kept as written.</span>
        </div>
        {canEdit && (
          <form
            className="mdf-log-add"
            onSubmit={(e) => {
              e.preventDefault();
              if (!logBody.trim()) return;
              m.addLog.mutate({ kind: logKind, body: logBody.trim() }, { onSuccess: () => setLogBody(""), onError: fail("Couldn't add the entry") });
            }}
          >
            <div className="theme-toggle mdf-log-kinds" role="group" aria-label="Kind of entry">
              {(["progress", "release"] as LogKind[]).map((k) => (
                <button key={k} type="button" className={logKind === k ? "active" : undefined} aria-pressed={logKind === k} onClick={() => setLogKind(k)}>
                  {k === "progress" ? "Progress" : "Release"}
                </button>
              ))}
            </div>
            <textarea
              rows={3}
              value={logBody}
              placeholder={logKind === "progress" ? "Where it stands, what's blocking, what's next…" : "How it went out — to whom, when, what to watch…"}
              aria-label="Log entry"
              onChange={(e) => setLogBody(e.target.value)}
            />
            <button type="submit" className="button primary small" disabled={!logBody.trim() || m.addLog.isPending}>
              Add entry
            </button>
          </form>
        )}
        {logLoading ? (
          <LoadingState label="Loading the log…" />
        ) : (log ?? []).length === 0 ? (
          <p className="hint-text">Nothing logged yet.</p>
        ) : (
          <ul className="mdf-log">
            {(log ?? []).map((e) => (
              <li key={e.id} className={`mdf-log-entry ${e.kind}`}>
                <div className="mdf-log-head">
                  <span className={`status-badge mdf-log-kind ${e.kind}`}>{e.kind === "release" ? "Release" : "Progress"}</span>
                  <span className="hint-text">
                    {formatDateTime(e.created_at)}
                    {e.author_username && ` · ${e.author_username}`}
                  </span>
                  {canEdit && (e.author_id === user?.id || user?.role === "admin") && (
                    <button
                      type="button"
                      className="link-button link-button-danger"
                      onClick={async () => {
                        if (await confirmDelete("Delete this log entry?")) m.deleteLog.mutate(e.id, { onError: fail("Couldn't delete the entry") });
                      }}
                    >
                      Delete
                    </button>
                  )}
                </div>
                <div className="mdf-log-body">{e.body}</div>
              </li>
            ))}
          </ul>
        )}
      </section>
      {dialog}
    </div>
  );
}
