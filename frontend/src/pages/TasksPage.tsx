import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ApiRequestError } from "../api/client";
import type { TaskQuery } from "../api/tasks";
import { RequireRole } from "../auth/RequireAuth";
import { LoadingState } from "../components/common/LoadingState";
import { EmptyState } from "../components/common/EmptyState";
import { TaskForm } from "../components/tasks/TaskForm";
import { TaskList } from "../components/tasks/TaskList";
import { useCreateTask, useMyWork, usePeople, useTasks } from "../state/hooks/useTasks";

type View = "mine" | "grabs" | "given" | "everyone" | "done";

const VIEWS: { key: View; label: string; query: TaskQuery; empty: string }[] = [
  { key: "mine", label: "Mine", query: { assignee: "me" }, empty: "Nothing on your list." },
  { key: "grabs", label: "Up for grabs", query: { assignee: "none" }, empty: "No tasks are waiting for someone to take them." },
  { key: "given", label: "I gave out", query: { created_by: "me" }, empty: "You haven't made any open tasks." },
  { key: "everyone", label: "Everyone", query: {}, empty: "No open tasks." },
  { key: "done", label: "Done", query: { state: "done" }, empty: "Nothing done yet." },
];

/** Everyone's to-dos: your own, ones up for grabs, ones you gave out, the whole
 * team's, and what's been done. "Everyone" can be narrowed to one person. */
export function TasksPage() {
  const [params, setParams] = useSearchParams();
  const view = (VIEWS.find((v) => v.key === params.get("view"))?.key ?? "mine") as View;
  const [person, setPerson] = useState("");
  const spec = VIEWS.find((v) => v.key === view)!;
  const query = view === "everyone" && person ? { ...spec.query, assignee: person } : spec.query;
  const { data: tasks, isLoading, error } = useTasks(query);
  const { data: work } = useMyWork();
  const { data: people } = usePeople();
  const create = useCreateTask();

  const counts: Partial<Record<View, number>> = {
    mine: work?.tasks.length,
    grabs: work?.unassigned_open,
  };

  return (
    <div className="page tasks-page">
      <h1>Tasks</h1>
      <RequireRole minimum="editor">
        <div className="card">
          <TaskForm
            pending={create.isPending}
            error={create.error instanceof ApiRequestError ? create.error.message : null}
            onSubmit={(input) => create.mutateAsync(input)}
          />
        </div>
      </RequireRole>

      <div className="card">
        <div className="tasks-toolbar">
          <div className="tab-bar" role="tablist">
            {VIEWS.map((v) => (
              <button
                key={v.key}
                type="button"
                role="tab"
                aria-selected={v.key === view}
                className={v.key === view ? "tab active" : "tab"}
                onClick={() => setParams(v.key === "mine" ? {} : { view: v.key })}
              >
                {v.label}
                {counts[v.key] ? <span className="section-count">{counts[v.key]}</span> : null}
              </button>
            ))}
          </div>
          {view === "everyone" && (
            <label className="inline-label">
              For
              <select value={person} onChange={(e) => setPerson(e.target.value)}>
                <option value="">Anyone</option>
                {(people ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.username}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        {error && <div className="error-text">{(error as Error).message}</div>}
        {isLoading ? (
          <LoadingState label="Loading tasks…" />
        ) : !tasks || tasks.length === 0 ? (
          <EmptyState compact title={spec.empty} />
        ) : (
          <TaskList tasks={tasks} />
        )}
        {view === "done" && <p className="hint-text">The latest 200.</p>}
      </div>
    </div>
  );
}
