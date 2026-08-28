import { api } from "./client";
import type { AuditActionCount, AuditGroupCount, AuditLogEntry } from "../types/domain";

export interface AuditLogPage {
  items: AuditLogEntry[];
  total: number;
}

export interface AuditLogFilters {
  entity_type?: string;
  action?: string;
  entity_id?: string;
  actor_id?: string;
  q?: string;
  since?: string;
  until?: string;
  limit?: number;
  offset?: number;
}

function toQueryString(filters: AuditLogFilters): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== "") params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export const auditLogApi = {
  list: (filters: AuditLogFilters = {}) => api.get<AuditLogPage>(`/audit-log${toQueryString(filters)}`),
  entityTypeCounts: () => api.get<AuditGroupCount[]>("/audit-log/entity-types"),
  actionCounts: (entityType?: string, entityId?: string) => {
    const params = new URLSearchParams();
    if (entityType) params.set("entity_type", entityType);
    if (entityId) params.set("entity_id", entityId);
    const qs = params.toString();
    return api.get<AuditActionCount[]>(`/audit-log/actions${qs ? `?${qs}` : ""}`);
  },
};
