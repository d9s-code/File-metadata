import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ewGroupsApi, type EwGroupInput } from "../../api/ewGroups";

export function ewGroupsKey(emitterId: string) {
  return ["ewGroups", emitterId] as const;
}

export function useEwGroups(emitterId: string) {
  return useQuery({ queryKey: ewGroupsKey(emitterId), queryFn: () => ewGroupsApi.list(emitterId) });
}

export function useCreateEwGroup(emitterId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: EwGroupInput) => ewGroupsApi.create(emitterId, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ewGroupsKey(emitterId) }),
  });
}

export function useDeleteEwGroup(emitterId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ewGroupId: string) => ewGroupsApi.delete(emitterId, ewGroupId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ewGroupsKey(emitterId) }),
  });
}
