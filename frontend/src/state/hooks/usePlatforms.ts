import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { platformsApi, type PlatformCreateInput } from "../../api/platforms";

export const platformsKey = ["platforms"] as const;

export function usePlatforms() {
  return useQuery({ queryKey: platformsKey, queryFn: () => platformsApi.list() });
}

export function usePlatform(id: string | undefined) {
  return useQuery({
    queryKey: [...platformsKey, id],
    queryFn: () => platformsApi.get(id as string),
    enabled: !!id,
  });
}

export function useCreatePlatform() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: PlatformCreateInput) => platformsApi.create(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: platformsKey }),
  });
}

export function useUpdatePlatform() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<PlatformCreateInput> }) =>
      platformsApi.update(id, input),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: platformsKey });
      qc.invalidateQueries({ queryKey: [...platformsKey, variables.id] });
    },
  });
}

export function useDeletePlatform() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, hard }: { id: string; hard?: boolean }) => platformsApi.delete(id, hard),
    onSuccess: () => qc.invalidateQueries({ queryKey: platformsKey }),
  });
}

export function useRestorePlatform() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => platformsApi.restore(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: platformsKey }),
  });
}

export function platformLinksKey(platformId: string) {
  return ["platformLinks", platformId] as const;
}

export function usePlatformLinks(platformId: string) {
  return useQuery({
    queryKey: platformLinksKey(platformId),
    queryFn: () => platformsApi.listLinks(platformId),
    enabled: !!platformId,
  });
}

export function usePinEmitter(platformId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ emitterId, emitterVersionId }: { emitterId: string; emitterVersionId: string }) =>
      platformsApi.pinEmitter(platformId, emitterId, emitterVersionId),
    onSuccess: () => qc.invalidateQueries({ queryKey: platformLinksKey(platformId) }),
  });
}

export function useUnpinEmitter(platformId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (emitterId: string) => platformsApi.unpinEmitter(platformId, emitterId),
    onSuccess: () => qc.invalidateQueries({ queryKey: platformLinksKey(platformId) }),
  });
}
