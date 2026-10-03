import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../../auth/AuthContext";
import { emittersApi } from "../../api/emitters";
import { platformsApi } from "../../api/platforms";
import { mdfsApi } from "../../api/mdfs";
import { ENTITY_LABELS, type Task, type TaskEntityType, type TaskInput } from "../../api/tasks";
import { usePeople } from "../../state/hooks/useTasks";

/** Who a task is for: "me", "anyone" (nobody yet), or a person's id. */
function assigneeValue(id: string | null | undefined, myId: string | undefined) {
  if (!id) return "anyone";
  return id === myId ? "me" : id;
}

function EntityPicker({
  type,
  id,
  onChange,
}: {
  type: TaskEntityType | "";
  id: string;
  onChange: (type: TaskEntityType | "", id: string) => void;
}) {
  // Only the chosen kind's list is fetched.
  const { data: items } = useQuery({
    queryKey: ["task-entity-options", type],
    queryFn: async (): Promise<{ id: string; name: string }[]> =>
      type === "emitter" ? emittersApi.list() : type === "platform" ? platformsApi.list() : mdfsApi.list(),
    enabled: type !== "",
  });
  return (
    <div className="task-form-about">
      <label>
        About
        <select aria-label="About" value={type} onChange={(e) => onChange(e.target.value as TaskEntityType | "", "")}>
          <option value="">Nothing in particular</option>
          <option value="emitter">An Emitter</option>
          <option value="platform">A Platform</option>
          <option value="mdf">An MDF</option>
        </select>
      </label>
      {type && (
        <label className="grow">
          {ENTITY_LABELS[type]}
          <select aria-label={ENTITY_LABELS[type]} value={id} onChange={(e) => onChange(type, e.target.value)} required>
            <option value="">{items ? `Choose one of ${items.length}…` : "Loading…"}</option>
            {(items ?? [])
              .slice()
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
          </select>
        </label>
      )}
    </div>
  );
}

/** New task, or editing one. `about` fixes what it's about (on an Emitter,
 * Platform or MDF page); without it, the form offers a picker. */
export function TaskForm({
  task,
  about,
  onSubmit,
  onCancel,
  pending,
  error,
}: {
  task?: Task;
  about?: { type: TaskEntityType; id: string };
  onSubmit: (input: TaskInput) => Promise<unknown>;
  onCancel?: () => void;
  pending: boolean;
  error?: string | null;
}) {
  const { user } = useAuth();
  const { data: people } = usePeople();
  const [title, setTitle] = useState(task?.title ?? "");
  const [notes, setNotes] = useState(task?.notes ?? "");
  const [showNotes, setShowNotes] = useState(!!task?.notes);
  const [assignee, setAssignee] = useState(task ? assigneeValue(task.assignee_id, user?.id) : "me");
  const [due, setDue] = useState(task?.due_date ?? "");
  const [entityType, setEntityType] = useState<TaskEntityType | "">("");
  const [entityId, setEntityId] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    const input: TaskInput = {
      title: title.trim(),
      notes: notes.trim() || null,
      assignee_id: assignee === "me" ? (user?.id ?? null) : assignee === "anyone" ? null : assignee,
      due_date: due || null,
    };
    if (!task) {
      const link = about ?? (entityType && entityId ? { type: entityType, id: entityId } : null);
      if (link) Object.assign(input, { entity_type: link.type, entity_id: link.id });
    }
    await onSubmit(input);
    if (!task) {
      setTitle("");
      setNotes("");
      setShowNotes(false);
      setDue("");
    }
  }

  return (
    <form className="task-form" onSubmit={(e) => void submit(e)}>
      <div className="task-form-row">
        <label className="grow">
          {task ? "Task" : "New task"}
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What needs doing?"
            maxLength={300}
            required
            autoFocus={!!task}
          />
        </label>
        <label>
          For
          <select aria-label="For" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
            <option value="me">Me</option>
            <option value="anyone">Anyone (up for grabs)</option>
            {(people ?? [])
              .filter((p) => p.id !== user?.id)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.username}
                  {p.role === "viewer" ? " (viewer)" : ""}
                </option>
              ))}
          </select>
        </label>
        <label>
          Due
          <input type="date" aria-label="Due" value={due} onChange={(e) => setDue(e.target.value)} />
        </label>
      </div>
      {!task && !about && (
        <EntityPicker
          type={entityType}
          id={entityId}
          onChange={(t, id) => {
            setEntityType(t);
            setEntityId(id);
          }}
        />
      )}
      {showNotes ? (
        <label>
          Details
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="What it involves — progress goes in its notes once it exists"
          />
        </label>
      ) : (
        <button type="button" className="link-button task-form-notes-toggle" onClick={() => setShowNotes(true)}>
          + Add details
        </button>
      )}
      {error && <div className="error-text">{error}</div>}
      <div className="task-form-actions">
        {onCancel && (
          <button type="button" className="button secondary" onClick={onCancel}>
            Cancel
          </button>
        )}
        <button type="submit" disabled={pending || !title.trim()}>
          {pending ? "Saving…" : task ? "Save" : "Add task"}
        </button>
      </div>
    </form>
  );
}
