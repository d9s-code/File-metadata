import { api } from "./client";

export type StatusEntityType = "emitter" | "platform" | "mdf";
export const STATUS_COLORS = ["grey", "blue", "green", "yellow", "amber", "orange", "red", "purple"] as const;
export type StatusColor = (typeof STATUS_COLORS)[number];

/** One status an Emitter, Platform or MDF can be in, as Admins set it up. */
export interface StatusDefinition {
  id: string;
  entity_type: StatusEntityType;
  key: string;
  label: string;
  color: StatusColor;
  position: number;
  /** Built in: can be renamed and recoloured, not deleted. */
  builtin: boolean;
  /** Keys of the statuses it can move to. */
  transitions: string[];
  requires_note: boolean;
  note_prompt: string | null;
  /** How many items are in it now. */
  in_use: number;
}

export interface MilestoneDefinition {
  id: string;
  entity_type: StatusEntityType;
  entity_id: string | null;
  status_key: string;
  title: string;
  description: string | null;
  position: number;
}

/** A milestone as one item has it: a default or its own, met or not. */
export interface ItemMilestone {
  id: string;
  status_key: string;
  title: string;
  description: string | null;
  is_default: boolean;
  done: boolean;
  done_at: string | null;
  done_by_username: string | null;
  note: string | null;
}

/** The 409 a status move gets when its milestones aren't all met. */
export interface UnmetMilestonesDetail {
  message: string;
  status: string;
  unmet_milestones: string[];
}

export function unmetMilestones(detail: unknown): UnmetMilestonesDetail | null {
  if (detail && typeof detail === "object" && Array.isArray((detail as UnmetMilestonesDetail).unmet_milestones)) {
    return detail as UnmetMilestonesDetail;
  }
  return null;
}

export const statusesApi = {
  list: () => api.get<StatusDefinition[]>("/statuses"),
  create: (entityType: StatusEntityType, label: string, color: StatusColor) =>
    api.post<StatusDefinition>("/statuses", { entity_type: entityType, label, color }),
  update: (
    id: string,
    changes: Partial<Pick<StatusDefinition, "label" | "color" | "transitions" | "requires_note" | "note_prompt">>,
  ) => api.patch<StatusDefinition>(`/statuses/${id}`, changes),
  reorder: (entityType: StatusEntityType, ids: string[]) =>
    api.post<StatusDefinition[]>("/statuses/reorder", { entity_type: entityType, ids }),
  delete: (id: string) => api.delete<void>(`/statuses/${id}`),

  defaults: (entityType: StatusEntityType) =>
    api.get<MilestoneDefinition[]>(`/milestones/defaults?entity_type=${entityType}`),
  createDefault: (entityType: StatusEntityType, statusKey: string, title: string, description?: string) =>
    api.post<MilestoneDefinition>("/milestones/defaults", {
      entity_type: entityType,
      status_key: statusKey,
      title,
      description,
    }),
  updateMilestone: (id: string, changes: { title?: string; description?: string; status_key?: string }) =>
    api.patch<MilestoneDefinition>(`/milestones/${id}`, changes),
  reorderMilestones: (ids: string[]) => api.post<MilestoneDefinition[]>("/milestones/reorder", { ids }),
  deleteMilestone: (id: string) => api.delete<void>(`/milestones/${id}`),

  itemMilestones: (entityType: StatusEntityType, entityId: string) =>
    api.get<ItemMilestone[]>(`/milestones/${entityType}/${entityId}`),
  addItemMilestone: (entityType: StatusEntityType, entityId: string, statusKey: string, title: string) =>
    api.post<ItemMilestone[]>(`/milestones/${entityType}/${entityId}`, { status_key: statusKey, title }),
  tick: (milestoneId: string, entityId: string, note?: string) =>
    api.put<ItemMilestone[]>(`/milestones/${milestoneId}/check/${entityId}`, { note: note || null }),
  untick: (milestoneId: string, entityId: string) =>
    api.delete<ItemMilestone[]>(`/milestones/${milestoneId}/check/${entityId}`),
};
