import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { functionGroupsApi, type FunctionGroupInput } from "../../api/functionGroups";

export function functionGroupsKey(emitterId: string) {
  return ["functionGroups", emitterId] as const;
}

export function useFunctionGroups(emitterId: string) {
  return useQuery({ queryKey: functionGroupsKey(emitterId), queryFn: () => functionGroupsApi.list(emitterId) });
}

export function useCreateFunctionGroup(emitterId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: FunctionGroupInput) => functionGroupsApi.create(emitterId, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: functionGroupsKey(emitterId) }),
  });
}

export function useUpdateFunctionGroup(emitterId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ functionGroupId, input }: { functionGroupId: string; input: Partial<FunctionGroupInput> }) =>
      functionGroupsApi.update(emitterId, functionGroupId, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: functionGroupsKey(emitterId) }),
  });
}

export function useDeleteFunctionGroup(emitterId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (functionGroupId: string) => functionGroupsApi.delete(emitterId, functionGroupId),
    onSuccess: () => qc.invalidateQueries({ queryKey: functionGroupsKey(emitterId) }),
  });
}
