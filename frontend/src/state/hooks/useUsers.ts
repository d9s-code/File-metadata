import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { usersApi, type UserCreateInput, type UserUpdateInput } from "../../api/users";

export const usersKey = ["users"] as const;

export function useUsers() {
  return useQuery({ queryKey: usersKey, queryFn: () => usersApi.list() });
}

export function useCreateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UserCreateInput) => usersApi.create(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: usersKey }),
  });
}

export function useUpdateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UserUpdateInput }) => usersApi.update(id, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: usersKey }),
  });
}
