import { api } from "./client";
import type { FunctionGroup } from "../types/domain";

export interface FunctionGroupInput {
  name: string;
  sort_order?: number;
}

export const functionGroupsApi = {
  list: (emitterId: string) => api.get<FunctionGroup[]>(`/emitters/${emitterId}/function-groups`),
  create: (emitterId: string, input: FunctionGroupInput) =>
    api.post<FunctionGroup>(`/emitters/${emitterId}/function-groups`, input),
  update: (emitterId: string, functionGroupId: string, input: Partial<FunctionGroupInput>) =>
    api.patch<FunctionGroup>(`/emitters/${emitterId}/function-groups/${functionGroupId}`, input),
  delete: (emitterId: string, functionGroupId: string) =>
    api.delete<void>(`/emitters/${emitterId}/function-groups/${functionGroupId}`),
};
