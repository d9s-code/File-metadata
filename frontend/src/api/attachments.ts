import { api, API_BASE_URL } from "./client";

export type AttachmentOwner = "emitter" | "platform" | "mdf";

/** A file kept with an Emitter, Platform or MDF. */
export interface Attachment {
  id: string;
  emitter_id: string | null;
  platform_id: string | null;
  mdf_id: string | null;
  filename: string;
  content_type: string;
  size_bytes: number;
  /** A PNG, JPEG, WebP or GIF the page shows, with a preview. */
  is_image: boolean;
  /** A picture's size as shown (a phone photo turned upright); null for other files. */
  width: number | null;
  height: number | null;
  description: string | null;
  position: number;
  created_at: string;
  updated_at: string;
  uploaded_by_username: string | null;
}

/** Matches MAX_BYTES in routers/attachments.py (the proxy takes 20 MB a request). */
export const ATTACHMENT_MAX_BYTES = 18 * 1024 * 1024;

export const attachmentUrl = (id: string) => `${API_BASE_URL}/attachments/${id}/file`;
export const attachmentThumbUrl = (id: string) => `${API_BASE_URL}/attachments/${id}/thumb`;
export const attachmentDownloadUrl = (id: string) => `${API_BASE_URL}/attachments/${id}/file?download=true`;

export const attachmentsApi = {
  list: (owner: AttachmentOwner, ownerId: string) =>
    api.get<Attachment[]>(`/attachments?owner=${owner}&owner_id=${encodeURIComponent(ownerId)}`),
  upload: (owner: AttachmentOwner, ownerId: string, file: File) => {
    const form = new FormData();
    form.set("owner", owner);
    form.set("owner_id", ownerId);
    form.set("file", file);
    return api.post<Attachment>("/attachments", form);
  },
  update: (id: string, input: { description: string | null }) => api.patch<Attachment>(`/attachments/${id}`, input),
  reorder: (owner: AttachmentOwner, ownerId: string, ids: string[]) =>
    api.put<Attachment[]>("/attachments/order", { owner, owner_id: ownerId, ids }),
  delete: (id: string) => api.delete<void>(`/attachments/${id}`),
};
