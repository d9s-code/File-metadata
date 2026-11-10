import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { functionCodesApi, type FunctionCodeInput } from "../../api/functionCodes";

export const functionCodesKey = ["function-codes"] as const;

export function useFunctionCodes() {
  return useQuery({ queryKey: functionCodesKey, queryFn: functionCodesApi.list });
}

/** Add, change and delete — each refreshes the list (and what groups by it). */
export function useFunctionCodeMutations() {
  const qc = useQueryClient();
  const refresh = () => {
    qc.invalidateQueries({ queryKey: functionCodesKey });
    qc.invalidateQueries({ queryKey: ["threat-priorities"] });
    qc.invalidateQueries({ queryKey: ["emitters"] });
  };
  return {
    create: useMutation({ mutationFn: (input: FunctionCodeInput) => functionCodesApi.create(input), onSuccess: refresh }),
    update: useMutation({
      mutationFn: ({ id, input }: { id: string; input: Partial<FunctionCodeInput> }) => functionCodesApi.update(id, input),
      onSuccess: refresh,
    }),
    remove: useMutation({
      mutationFn: ({ id, moveTo }: { id: string; moveTo?: string }) => functionCodesApi.delete(id, moveTo),
      onSuccess: refresh,
    }),
  };
}
