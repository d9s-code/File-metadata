import { api } from "./client";
import type { User } from "../types/domain";

export const authApi = {
  login: (username: string, password: string) => api.post<User>("/auth/login", { username, password }),
  logout: () => api.post<{ ok: boolean }>("/auth/logout"),
  me: () => api.get<User>("/auth/me"),
};
