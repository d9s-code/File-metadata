import { api } from "./client";

export interface Dashboard {
  emitter_status_counts: Record<string, number>;
  mdf_status_counts: Record<string, number>;
  needs_attention: string[];
}

export const dashboardApi = {
  get: () => api.get<Dashboard>("/dashboard"),
};
