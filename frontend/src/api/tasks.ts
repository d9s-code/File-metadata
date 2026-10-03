import { api } from "./client";

export type TaskEntityType = "emitter" | "platform" | "mdf";

export interface Task {
  id: string;
  title: string;
  notes: string | null;
  /** null: anyone can pick it up. */
  assignee_id: string | null;
  assignee_username: string | null;
  created_by_id: string | null;
  created_by_username: string | null;
  due_date: string | null;
  done_at: string | null;
  done_by_username: string | null;
  entity_type: TaskEntityType | null;
  entity_id: string | null;
  entity_name: string | null;
  entity_deleted: boolean;
  note_count: number;
  created_at: string;
  updated_at: string;
}

/** One entry in a task's running notes. */
export interface TaskNote {
  id: string;
  author_id: string | null;
  author_username: string | null;
  body: string;
  created_at: string;
}

export interface TaskInput {
  title: string;
  notes?: string | null;
  assignee_id?: string | null;
  due_date?: string | null;
  entity_type?: TaskEntityType | null;
  entity_id?: string | null;
}

export type TaskPatch = Partial<Omit<TaskInput, "entity_type" | "entity_id">> & { done?: boolean };

export interface TaskQuery {
  assignee?: "me" | "none" | string;
  created_by?: "me" | string;
  state?: "open" | "done" | "all";
  entity_type?: TaskEntityType;
  entity_id?: string;
}

export interface Person {
  id: string;
  username: string;
  role: "viewer" | "editor" | "admin";
}

export interface AssignedEmitter {
  id: string;
  name: string;
  status: string;
  checked_out_by_username: string | null;
  open_tasks: number;
}

export interface MyWork {
  tasks: Task[];
  emitters: AssignedEmitter[];
  unassigned_open: number;
}

export const ENTITY_PATHS: Record<TaskEntityType, string> = { emitter: "/emitters", platform: "/platforms", mdf: "/mdfs" };
export const ENTITY_LABELS: Record<TaskEntityType, string> = { emitter: "Emitter", platform: "Platform", mdf: "MDF" };

export const tasksApi = {
  list: (query: TaskQuery) => {
    const params = new URLSearchParams(Object.entries(query).filter(([, v]) => v) as [string, string][]);
    return api.get<Task[]>(`/tasks?${params.toString()}`);
  },
  myWork: () => api.get<MyWork>("/tasks/my-work"),
  create: (input: TaskInput) => api.post<Task>("/tasks", input),
  update: (id: string, patch: TaskPatch) => api.patch<Task>(`/tasks/${id}`, patch),
  remove: (id: string) => api.delete<void>(`/tasks/${id}`),
  notes: (taskId: string) => api.get<TaskNote[]>(`/tasks/${taskId}/notes`),
  addNote: (taskId: string, body: string) => api.post<TaskNote>(`/tasks/${taskId}/notes`, { body }),
  deleteNote: (taskId: string, noteId: string) => api.delete<void>(`/tasks/${taskId}/notes/${noteId}`),
  people: () => api.get<Person[]>("/people"),
  assignEmitter: (emitterId: string, assigneeId: string | null) =>
    api.put(`/emitters/${emitterId}/assignee`, { assignee_id: assigneeId }),
};
