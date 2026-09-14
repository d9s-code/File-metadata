import { api } from "./client";
import type { SourceGroup } from "../types/domain";

export const sourceGroupsApi = {
  list: () => api.get<SourceGroup[]>("/source-groups/"),
  create: (input: { name: string; description?: string }) =>
    api.post<SourceGroup>("/source-groups/", input),
  update: (id: string, input: Partial<{ name: string; description: string }>) =>
    api.patch<SourceGroup>(`/source-groups/${id}`, input),
  delete: (id: string) => api.delete<void>(`/source-groups/${id}`),
};
