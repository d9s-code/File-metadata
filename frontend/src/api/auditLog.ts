import { api } from "./client";
import type { AuditActionCount, AuditEntitySearchResult, AuditGroupCount, AuditLogEntry } from "../types/domain";

export interface AuditLogPage {
  items: AuditLogEntry[];
  total: number;
}

export interface AuditLogFilters {
  entity_type?: string;
  action?: string;
  entity_id?: string;
  actor_id?: string;
  /** Rolls up every entry under this Emitter (its own entries plus its EW
   * Groups/Sources/Modes/elements/generation batches/imports/test records),
   * regardless of entity_type — combine with entity_type/action to narrow
   * within the rollup rather than passing entity_type/entity_id instead. */
  emitter_id?: string;
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
  actionCounts: (entityType?: string, entityId?: string, emitterId?: string) => {
    const params = new URLSearchParams();
    if (entityType) params.set("entity_type", entityType);
    if (entityId) params.set("entity_id", entityId);
    if (emitterId) params.set("emitter_id", emitterId);
    const qs = params.toString();
    return api.get<AuditActionCount[]>(`/audit-log/actions${qs ? `?${qs}` : ""}`);
  },
  searchEntities: (q: string) =>
    api.get<AuditEntitySearchResult[]>(`/audit-log/entities?q=${encodeURIComponent(q)}`),
};
