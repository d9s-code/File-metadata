import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { modesApi, type ModeCreateInput } from "../../api/modes";

export function modesKey(ewGroupId: string) {
  return ["modes", ewGroupId] as const;
}

export function useModes(ewGroupId: string) {
  return useQuery({ queryKey: modesKey(ewGroupId), queryFn: () => modesApi.list(ewGroupId) });
}

export function useCreateMode(ewGroupId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ModeCreateInput) => modesApi.create(ewGroupId, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: modesKey(ewGroupId) }),
  });
}

export function useDeleteMode(ewGroupId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (modeId: string) => modesApi.delete(ewGroupId, modeId),
    onSuccess: () => qc.invalidateQueries({ queryKey: modesKey(ewGroupId) }),
  });
}
