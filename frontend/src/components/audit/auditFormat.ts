import type { AuditAction } from "../../types/domain";

const ENTITY_TYPE_LABELS: Record<string, string> = {
  emitter: "Emitters",
  ew_group: "EW Groups",
  source: "Sources",
  mode_element: "Elements",
  mode: "Modes",
  mode_generation_batch: "Generation Batches",
  platform: "Platforms",
  platform_link: "Platform Links",
  mdf: "MDFs",
  mdf_link: "MDF Links",
  test_record: "Test Records",
  user: "Users",
  auth: "Auth",
};

export function entityTypeLabel(entityType: string): string {
  return ENTITY_TYPE_LABELS[entityType] ?? entityType;
}

const ACTION_LABELS: Record<AuditAction, string> = {
  create: "Created",
  update: "Updated",
  delete: "Deleted",
  status_change: "Status change",
  commit: "Committed",
  login: "Logged in",
  login_failed: "Login failed",
  logout: "Logged out",
};

export function actionLabel(action: AuditAction): string {
  return ACTION_LABELS[action] ?? action;
}
