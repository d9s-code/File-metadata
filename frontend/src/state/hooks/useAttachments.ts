import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { attachmentsApi, type Attachment, type AttachmentOwner } from "../../api/attachments";

export const attachmentsKey = (owner: AttachmentOwner, ownerId: string) => ["attachments", owner, ownerId] as const;

export function useAttachments(owner: AttachmentOwner, ownerId: string) {
  return useQuery({
    queryKey: attachmentsKey(owner, ownerId),
    queryFn: () => attachmentsApi.list(owner, ownerId),
    enabled: !!ownerId,
  });
}

/** Changes to one owner's files; each refreshes the list (and the Audit Log). */
export function useAttachmentMutations(owner: AttachmentOwner, ownerId: string) {
  const qc = useQueryClient();
  const key = attachmentsKey(owner, ownerId);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: key });
    qc.invalidateQueries({ queryKey: ["auditLog"] });
  };
  const upload = useMutation({ mutationFn: (file: File) => attachmentsApi.upload(owner, ownerId, file), onSuccess: refresh });
  const update = useMutation({
    mutationFn: ({ id, description }: { id: string; description: string | null }) =>
      attachmentsApi.update(id, { description }),
    onSuccess: refresh,
  });
  const reorder = useMutation({
    mutationFn: (ids: string[]) => attachmentsApi.reorder(owner, ownerId, ids),
    // Shown in the new order at once; put right by the refresh if refused.
    onMutate: (ids) => {
      const current = qc.getQueryData<Attachment[]>(key);
      if (current) {
        const byId = new Map(current.map((a) => [a.id, a]));
        qc.setQueryData(key, ids.map((id) => byId.get(id)).filter((a): a is Attachment => !!a));
      }
    },
    onSettled: refresh,
  });
  const remove = useMutation({ mutationFn: (id: string) => attachmentsApi.delete(id), onSuccess: refresh });
  return { upload, update, reorder, remove };
}
