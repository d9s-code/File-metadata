import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { trashApi, type TrashEntityType } from "../../api/trash";
import { emittersApi } from "../../api/emitters";
import { platformsApi } from "../../api/platforms";
import { mdfsApi } from "../../api/mdfs";
import { emittersKey } from "./useEmitters";
import { platformsKey } from "./usePlatforms";
import { mdfsKey } from "./useMdfs";

export const trashKey = ["trash"] as const;

const RESTORE_BY_TYPE: Record<TrashEntityType, (id: string) => Promise<unknown>> = {
  emitter: emittersApi.restore,
  platform: platformsApi.restore,
  mdf: mdfsApi.restore,
};

const LIST_KEY_BY_TYPE: Record<TrashEntityType, readonly string[]> = {
  emitter: emittersKey,
  platform: platformsKey,
  mdf: mdfsKey,
};

export function useTrash() {
  return useQuery({ queryKey: trashKey, queryFn: () => trashApi.list() });
}

export function useRestoreEntity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ entityType, id }: { entityType: TrashEntityType; id: string }) =>
      RESTORE_BY_TYPE[entityType](id),
    onSuccess: (_data, { entityType }) => {
      qc.invalidateQueries({ queryKey: trashKey });
      qc.invalidateQueries({ queryKey: LIST_KEY_BY_TYPE[entityType] });
    },
  });
}

export function usePurgeForever() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ entityType, id }: { entityType: TrashEntityType; id: string }) =>
      trashApi.purgeForever(entityType, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: trashKey }),
  });
}
