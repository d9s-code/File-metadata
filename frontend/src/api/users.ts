import { api } from "./client";
import type { Role, User } from "../types/domain";

export interface UserCreateInput {
  username: string;
  password: string;
  role: Role;
}

export interface UserUpdateInput {
  role?: Role;
  is_active?: boolean;
  password?: string;
}

export const usersApi = {
  list: () => api.get<User[]>("/users"),
  create: (input: UserCreateInput) => api.post<User>("/users", input),
  update: (id: string, input: UserUpdateInput) => api.patch<User>(`/users/${id}`, input),
};
