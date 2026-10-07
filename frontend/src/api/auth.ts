import { api } from "./client";
import type { User, UserPreferences } from "../types/domain";

export const authApi = {
  login: (username: string, password: string) => api.post<User>("/auth/login", { username, password }),
  logout: () => api.post<{ ok: boolean }>("/auth/logout"),
  me: () => api.get<User>("/auth/me"),
  changePassword: (currentPassword: string, newPassword: string) =>
    api.post<{ ok: boolean }>("/auth/change-password", { current_password: currentPassword, new_password: newPassword }),
  updatePreferences: (changes: Partial<UserPreferences>) => api.patch<User>("/auth/me/preferences", changes),
};
