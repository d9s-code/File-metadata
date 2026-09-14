import { useQuery } from "@tanstack/react-query";
import { auditLogApi, type AuditLogFilters } from "../../api/auditLog";

export function auditLogKey(filters: AuditLogFilters) {
  return ["auditLog", filters] as const;
}

export function useAuditLog(filters: AuditLogFilters) {
  return useQuery({
    queryKey: auditLogKey(filters),
    queryFn: () => auditLogApi.list(filters),
  });
}

export function useAuditEntityTypeCounts() {
  return useQuery({
    queryKey: ["auditLog", "entity-types"] as const,
    queryFn: () => auditLogApi.entityTypeCounts(),
  });
}

export function useAuditActionCounts(entityType?: string, entityId?: string, emitterId?: string) {
  return useQuery({
    queryKey: ["auditLog", "actions", entityType, entityId, emitterId] as const,
    queryFn: () => auditLogApi.actionCounts(entityType, entityId, emitterId),
  });
}

export function useAuditEntitySearch(q: string) {
  const trimmed = q.trim();
  return useQuery({
    queryKey: ["auditLog", "entities", trimmed] as const,
    queryFn: () => auditLogApi.searchEntities(trimmed),
    enabled: trimmed.length >= 2,
  });
}
