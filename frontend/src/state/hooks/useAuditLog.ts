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

export function useAuditActionCounts(entityType?: string, entityId?: string) {
  return useQuery({
    queryKey: ["auditLog", "actions", entityType, entityId] as const,
    queryFn: () => auditLogApi.actionCounts(entityType, entityId),
  });
}
