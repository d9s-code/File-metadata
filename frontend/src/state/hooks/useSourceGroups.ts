import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { sourceGroupsApi } from "../../api/source_groups";

export function useSourceGroups() {
  const queryClient = useQueryClient();

  const { data: sourceGroups = [], isLoading, error } = useQuery({
    queryKey: ["sourceGroups"],
    queryFn: sourceGroupsApi.list,
  });

  const createMutation = useMutation({
    mutationFn: sourceGroupsApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sourceGroups"] });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<{ name: string; description: string }> }) =>
      sourceGroupsApi.update(id, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sourceGroups"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: sourceGroupsApi.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sourceGroups"] });
    },
  });

  return {
    sourceGroups,
    isLoading,
    error,
    createGroup: createMutation.mutateAsync,
    updateGroup: updateMutation.mutateAsync,
    deleteGroup: deleteMutation.mutateAsync,
    isCreating: createMutation.isPending,
    isUpdating: updateMutation.isPending,
    isDeleting: deleteMutation.isPending,
  };
}
