import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customersApi, type CustomerInput } from "../../api/customers";

export const customersKey = ["customers"] as const;

export function useCustomers() {
  return useQuery({ queryKey: customersKey, queryFn: () => customersApi.list() });
}

export function useCreateCustomer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CustomerInput) => customersApi.create(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: customersKey }),
  });
}

export function useUpdateCustomer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ customerId, input }: { customerId: string; input: Partial<CustomerInput> }) =>
      customersApi.update(customerId, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: customersKey }),
  });
}

export function useDeleteCustomer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (customerId: string) => customersApi.delete(customerId),
    onSuccess: () => qc.invalidateQueries({ queryKey: customersKey }),
  });
}
