import { useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { useHasRole } from "../../auth/RequireAuth";
import { ApiRequestError } from "../../api/client";
import { ENTITY_LABELS, ENTITY_PATHS, type Task } from "../../api/tasks";
import { useDeleteTask, useUpdateTask } from "../../state/hooks/useTasks";
import { MenuButton } from "../common/MenuButton";
import { Modal } from "../common/Modal";
import { useConfirmDialog } from "../common/ConfirmDialog";
import { TaskForm } from "./TaskForm";

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** "Due 10 Oct", "Due today", "Overdue · 2 Oct". */
export function DueTag({ due, done }: { due: string | null; done?: boolean }) {
  if (!due) return null;
  const label = new Date(`${due}T00:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short" });
  const now = today();
  const state = done ? "" : due < now ? "overdue" : due === now ? "today" : "";
  return (
    <span className={`task-due ${state}`}>
      {state === "overdue" ? `Overdue · ${label}` : state === "today" ? "Due today" : `Due ${label}`}
    </span>
  );
}

function TaskRow({ task, showAbout }: { task: Task; showAbout: boolean }) {
  const { user } = useAuth();
  const canEdit = useHasRole("editor");
  const isAdmin = useHasRole("admin");
  const update = useUpdateTask();
  const remove = useDeleteTask();
  const { confirmDelete, dialog } = useConfirmDialog();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Ticked or unticked while the server catches up, so the box answers at once.
  const [ticking, setTicking] = useState<boolean | null>(null);
  const done = !!task.done_at;
  const mine = task.assignee_id === user?.id;
  const canTick = canEdit || mine;
  const canDelete = canEdit && (isAdmin || mine || task.created_by_id === user?.id);

  async function patch(p: Parameters<typeof update.mutateAsync>[0]["patch"]): Promise<boolean> {
    setError(null);
    try {
      await update.mutateAsync({ id: task.id, patch: p });
      return true;
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Couldn't save that");
      return false;
    }
  }

  async function del() {
    if (await confirmDelete(`Delete the task "${task.title}"?`)) await remove.mutateAsync(task.id);
  }

  return (
    <li className={done ? "task-row done" : "task-row"}>
      <input
        type="checkbox"
        className="task-check"
        checked={ticking ?? done}
        disabled={!canTick || ticking !== null}
        title={canTick ? (done ? "Mark as not done" : "Mark as done") : "Only editors, or whoever it's for, can tick it off"}
        aria-label={done ? `Mark "${task.title}" as not done` : `Mark "${task.title}" as done`}
        onChange={() => {
          setTicking(!done);
          void patch({ done: !done }).finally(() => setTicking(null));
        }}
      />
      <div className="task-body">
        <div className="task-main">
          <span className="task-title">{task.title}</span>
          {showAbout && task.entity_type && task.entity_id && (
            <span className="task-about">
              {ENTITY_LABELS[task.entity_type]}{" "}
              {task.entity_name && !task.entity_deleted ? (
                <Link to={`${ENTITY_PATHS[task.entity_type]}/${task.entity_id}`}>{task.entity_name}</Link>
              ) : (
                <span className="muted">{task.entity_name ? `${task.entity_name} (deleted)` : "(deleted)"}</span>
              )}
            </span>
          )}
        </div>
        {task.notes && <p className="task-notes">{task.notes}</p>}
        <div className="task-meta">
          <span className={task.assignee_id ? "task-who" : "task-who anyone"}>
            {task.assignee_username ? (mine ? "You" : task.assignee_username) : "Up for grabs"}
          </span>
          <DueTag due={task.due_date} done={done} />
          <span className="hint-text">
            {task.created_by_username && task.created_by_id !== task.assignee_id ? `from ${task.created_by_username}` : ""}
            {done && task.done_at && ` · done ${new Date(task.done_at).toLocaleDateString(undefined, { day: "numeric", month: "short" })}${task.done_by_username && task.done_by_username !== task.assignee_username ? ` by ${task.done_by_username}` : ""}`}
          </span>
          {!task.assignee_id && canEdit && !done && (
            <button type="button" className="link-button" onClick={() => void patch({ assignee_id: user?.id ?? null })}>
              Take it
            </button>
          )}
        </div>
        {error && <div className="error-text">{error}</div>}
      </div>
      {canEdit && (
        <MenuButton
          label="⋯"
          items={[
            { label: "Edit…", onSelect: () => setEditing(true) },
            ...(task.assignee_id && !mine ? [{ label: "Take it", onSelect: () => void patch({ assignee_id: user?.id ?? null }) }] : []),
            ...(task.assignee_id ? [{ label: "Put up for grabs", onSelect: () => void patch({ assignee_id: null }) }] : []),
            ...(canDelete ? [{ label: "Delete", danger: true, onSelect: () => void del() }] : []),
          ]}
        />
      )}
      {editing && (
        <Modal title="Edit task" onClose={() => setEditing(false)} wide>
          <TaskForm
            task={task}
            pending={update.isPending}
            error={error}
            onCancel={() => setEditing(false)}
            onSubmit={async (input) => {
              const ok = await patch({ title: input.title, notes: input.notes, assignee_id: input.assignee_id, due_date: input.due_date });
              if (ok) setEditing(false);
            }}
          />
        </Modal>
      )}
      {dialog}
    </li>
  );
}

/** Tasks, one per row: tick box, title, what it's about, who it's for, when it's due. */
export function TaskList({ tasks, showAbout = true }: { tasks: Task[]; showAbout?: boolean }) {
  return (
    <ul className="task-list">
      {tasks.map((t) => (
        <TaskRow key={t.id} task={t} showAbout={showAbout} />
      ))}
    </ul>
  );
}
