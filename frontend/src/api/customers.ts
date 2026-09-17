import { api } from "./client";

export interface Customer {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface CustomerInput {
  name: string;
}

export const customersApi = {
  list: () => api.get<Customer[]>("/customers"),
  create: (input: CustomerInput) => api.post<Customer>("/customers", input),
  update: (customerId: string, input: Partial<CustomerInput>) =>
    api.patch<Customer>(`/customers/${customerId}`, input),
  delete: (customerId: string) => api.delete<void>(`/customers/${customerId}`),
};
