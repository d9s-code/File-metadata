import { useState, type FormEvent } from "react";
import { ApiRequestError } from "../../api/client";
import type { ItemMilestone, StatusEntityType } from "../../api/statuses";
import { RequireRole, useHasRole } from "../../auth/RequireAuth";
import { Modal } from "../common/Modal";
import { formatDate } from "../common/dates";
import { useItemMilestoneActions, useItemMilestones, useStatuses } from "../../state/hooks/useStatuses";
import { StatusBadge } from "./StatusBadge";

const NOUN: Record<StatusEntityType, string> = { emitter: "Emitter", platform: "Platform", mdf: "MDF" };

/** "◎ Milestones · 1/3" on an Emitter, Platform or MDF page — how many of the
 * milestones for the statuses it can move to next are met. Opens the list:
 * every milestone by status, ticked off by hand with a note, and this
 * item's own ones added beside the defaults Admins set. */
export function MilestonesButton({ type, id, status }: { type: StatusEntityType; id: string; status: string }) {
  const [open, setOpen] = useState(false);
  const statuses = useStatuses(type);
  const { data: milestones } = useItemMilestones(type, id);
  const nextKeys = new Set(statuses.byKey[status]?.transitions ?? []);
  const upcoming = (milestones ?? []).filter((m) => nextKeys.has(m.status_key));
  const met = upcoming.filter((m) => m.done).length;

  return (
    <>
      <button
        type="button"
        className={upcoming.length && met < upcoming.length ? "task-count-chip has-open" : "task-count-chip"}
        onClick={() => setOpen(true)}
        title={
          upcoming.length
            ? `${met} of ${upcoming.length} milestones for the next status met`
            : "What needs doing before each status"
        }
      >
        ◎ Milestones{upcoming.length > 0 && ` · ${met}/${upcoming.length}`}
      </button>
      {open && (
        <Modal title={`Milestones — this ${NOUN[type]}`} onClose={() => setOpen(false)} wide>
          <MilestonesPanel type={type} id={id} status={status} milestones={milestones ?? []} />
        </Modal>
      )}
    </>
  );
}

function MilestonesPanel({
  type,
  id,
  status,
  milestones,
}: {
  type: StatusEntityType;
  id: string;
  status: string;
  milestones: ItemMilestone[];
}) {
  const statuses = useStatuses(type);
  const actions = useItemMilestoneActions(type, id);
  const nextKeys = new Set(statuses.byKey[status]?.transitions ?? []);
  const [error, setError] = useState<string | null>(null);

  const groups = statuses.list
    .map((s) => ({ s, items: milestones.filter((m) => m.status_key === s.key) }))
    .filter((g) => g.items.length > 0);

  async function run(p: Promise<unknown>) {
    setError(null);
    try {
      await p;
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Couldn't save that");
    }
  }

  return (
    <div className="milestones-panel">
      <p className="hint-text">
        What to get done before this {NOUN[type]} reaches each status. Moving to a status with milestones not met
        asks to confirm first. The defaults are set by Admins under Admin → Statuses &amp; milestones.
      </p>
      {groups.length === 0 && <p className="hint-text">No milestones yet.</p>}
      {groups.map(({ s, items }) => {
        const done = items.filter((m) => m.done).length;
        return (
          <section key={s.key} className={nextKeys.has(s.key) ? "milestone-group next" : "milestone-group"}>
            <h5>
              Before <StatusBadge type={type} status={s.key} />
              <span className="hint-text">
                {done}/{items.length} met{nextKeys.has(s.key) ? " · next" : s.key === status ? " · current" : ""}
              </span>
            </h5>
            <ul className="milestone-list">
              {items.map((m) => (
                <MilestoneRow
                  key={m.id}
                  m={m}
                  onTick={(note) => run(actions.tick.mutateAsync({ id: m.id, note }))}
                  onUntick={() => run(actions.untick.mutateAsync(m.id))}
                  onRemove={() => run(actions.remove.mutateAsync(m.id))}
                />
              ))}
            </ul>
          </section>
        );
      })}
      {error && <p className="error-text">{error}</p>}
      <RequireRole minimum="editor">
        <AddMilestone
          type={type}
          defaultStatus={[...nextKeys][0] ?? statuses.list[0]?.key ?? ""}
          pending={actions.add.isPending}
          onAdd={(statusKey, title) => run(actions.add.mutateAsync({ statusKey, title }))}
        />
      </RequireRole>
    </div>
  );
}

function MilestoneRow({
  m,
  onTick,
  onUntick,
  onRemove,
}: {
  m: ItemMilestone;
  onTick: (note?: string) => Promise<void>;
  onUntick: () => Promise<void>;
  onRemove: () => Promise<void>;
}) {
  const canEdit = useHasRole("editor");
  const [editingNote, setEditingNote] = useState(false);
  const [note, setNote] = useState(m.note ?? "");

  return (
    <li className={m.done ? "milestone done" : "milestone"}>
      <label className="milestone-title">
        <input
          type="checkbox"
          checked={m.done}
          disabled={!canEdit}
          onChange={() => void (m.done ? onUntick() : onTick())}
          aria-label={m.done ? `Mark "${m.title}" not met` : `Mark "${m.title}" met`}
        />
        <span>{m.title}</span>
      </label>
      {!m.is_default && <span className="milestone-own">its own</span>}
      {m.description && <div className="hint-text milestone-desc">{m.description}</div>}
      {m.done && (
        <div className="hint-text milestone-done">
          ✓ {m.done_by_username ?? "someone"}, {formatDate(m.done_at)}
          {m.note && !editingNote && <> — {m.note}</>}
          {canEdit && !editingNote && (
            <button type="button" className="link-button" onClick={() => setEditingNote(true)}>
              {m.note ? "Edit note" : "Add a note"}
            </button>
          )}
        </div>
      )}
      {editingNote && (
        <form
          className="milestone-note-form"
          onSubmit={(e) => {
            e.preventDefault();
            void onTick(note.trim()).then(() => setEditingNote(false));
          }}
        >
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Passed on the range, 14.10" autoFocus />
          <button type="submit" className="button small">
            Save
          </button>
          <button type="button" className="link-button" onClick={() => setEditingNote(false)}>
            Cancel
          </button>
        </form>
      )}
      {!m.is_default && canEdit && (
        <button type="button" className="link-button danger milestone-remove" onClick={() => void onRemove()}>
          Remove
        </button>
      )}
    </li>
  );
}

function AddMilestone({
  type,
  defaultStatus,
  pending,
  onAdd,
}: {
  type: StatusEntityType;
  defaultStatus: string;
  pending: boolean;
  onAdd: (statusKey: string, title: string) => Promise<void>;
}) {
  const statuses = useStatuses(type);
  const [statusKey, setStatusKey] = useState(defaultStatus);
  const [title, setTitle] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim() || !statusKey) return;
    await onAdd(statusKey, title.trim());
    setTitle("");
  }

  return (
    <form className="milestone-add" onSubmit={submit}>
      <span className="hint-text">Add one for this {NOUN[type]} only:</span>
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Manual dwell test passed" />
      <label className="inline-label">
        before
        <select value={statusKey} onChange={(e) => setStatusKey(e.target.value)}>
          {statuses.list.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" className="button secondary small" disabled={pending || !title.trim()}>
        Add
      </button>
    </form>
  );
}
