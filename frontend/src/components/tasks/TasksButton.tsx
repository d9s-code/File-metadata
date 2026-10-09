import { useState } from "react";
import { Link } from "react-router-dom";
import { ApiRequestError } from "../../api/client";
import type { TaskEntityType } from "../../api/tasks";
import { useCreateTask, useTasks } from "../../state/hooks/useTasks";
import { RequireRole } from "../../auth/RequireAuth";
import { Modal } from "../common/Modal";
import { TaskForm } from "./TaskForm";
import { TaskList } from "./TaskList";

/** "Tasks · 2" on an Emitter, Platform or MDF page: its tasks, and adding one.
 * In a list, give `openCount` (counted once for every row) and its tasks are
 * only fetched when opened; `compact` shows just "☑ 2". */
export function TasksButton({
  type,
  id,
  name,
  openCount,
  compact,
}: {
  type: TaskEntityType;
  id: string;
  name: string;
  openCount?: number;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const { data: tasks } = useTasks({ entity_type: type, entity_id: id, state: "all" }, openCount === undefined || open);
  const create = useCreateTask();
  const openTasks = (tasks ?? []).filter((t) => !t.done_at);
  const doneTasks = (tasks ?? []).filter((t) => t.done_at);
  const count = tasks ? openTasks.length : (openCount ?? 0);

  return (
    <>
      <button
        type="button"
        className={count ? "task-count-chip has-open" : "task-count-chip"}
        onClick={() => setOpen(true)}
        title={`${count} open task${count === 1 ? "" : "s"} — open to add one, or tick them off`}
      >
        {compact ? `☑ ${count}` : <>☑ Tasks{count > 0 && ` · ${count}`}</>}
      </button>
      {open && (
        <Modal title={`Tasks — ${name}`} onClose={() => setOpen(false)} wide>
          <RequireRole minimum="editor">
            <TaskForm
              about={{ type, id }}
              pending={create.isPending}
              error={create.error instanceof ApiRequestError ? create.error.message : null}
              onSubmit={(input) => create.mutateAsync(input)}
            />
          </RequireRole>
          {openTasks.length === 0 ? (
            <p className="hint-text">No open tasks about this.</p>
          ) : (
            <TaskList tasks={openTasks} showAbout={false} />
          )}
          {doneTasks.length > 0 && (
            <button type="button" className="link-button" onClick={() => setShowDone((v) => !v)}>
              {showDone ? "Hide done" : `Show ${doneTasks.length} done`}
            </button>
          )}
          {showDone && <TaskList tasks={doneTasks} showAbout={false} />}
          <p className="hint-text task-modal-footer">
            Everyone&apos;s tasks are on the <Link to="/tasks">Tasks</Link> page.
          </p>
        </Modal>
      )}
    </>
  );
}
