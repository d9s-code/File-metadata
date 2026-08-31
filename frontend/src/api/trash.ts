import { api } from "./client";

export type TrashEntityType = "emitter" | "platform" | "mdf";

export interface DeletedItem {
  entity_type: TrashEntityType;
  id: string;
  name: string;
  deleted_at: string;
  expires_at: string;
}

export const trashApi = {
  list: () => api.get<DeletedItem[]>("/trash"),
  purgeForever: (entityType: TrashEntityType, id: string) => api.delete<void>(`/trash/${entityType}/${id}`),
};
