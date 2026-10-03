import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { tasksApi, type TaskInput, type TaskPatch, type TaskQuery } from "../../api/tasks";
import { emittersKey } from "./useEmitters";

export const tasksKey = ["tasks"] as const;

export function useTasks(query: TaskQuery, enabled = true) {
  return useQuery({ queryKey: [...tasksKey, "list", query], queryFn: () => tasksApi.list(query), enabled });
}

/** Your open tasks and Emitters — the dashboard strip and the nav count. */
export function useMyWork(enabled = true) {
  return useQuery({ queryKey: [...tasksKey, "my-work"], queryFn: () => tasksApi.myWork(), enabled, refetchInterval: 2 * 60_000 });
}

export function usePeople() {
  return useQuery({ queryKey: ["people"], queryFn: () => tasksApi.people(), staleTime: 5 * 60_000 });
}

export function useCreateTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: TaskInput) => tasksApi.create(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: tasksKey }),
  });
}

export function useUpdateTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: TaskPatch }) => tasksApi.update(id, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: tasksKey }),
  });
}

export function useDeleteTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => tasksApi.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: tasksKey }),
  });
}

export function useTaskNotes(taskId: string, enabled: boolean) {
  return useQuery({ queryKey: [...tasksKey, "notes", taskId], queryFn: () => tasksApi.notes(taskId), enabled });
}

/** Adding or deleting a note changes the task's note count too, so every task list refreshes. */
export function useAddTaskNote(taskId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: string) => tasksApi.addNote(taskId, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: tasksKey }),
  });
}

export function useDeleteTaskNote(taskId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (noteId: string) => tasksApi.deleteNote(taskId, noteId),
    onSuccess: () => qc.invalidateQueries({ queryKey: tasksKey }),
  });
}

export function useAssignEmitter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ emitterId, assigneeId }: { emitterId: string; assigneeId: string | null }) =>
      tasksApi.assignEmitter(emitterId, assigneeId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: emittersKey });
      qc.invalidateQueries({ queryKey: tasksKey });
    },
  });
}
