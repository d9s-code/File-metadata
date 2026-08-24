import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "./AuthContext";

export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="page-loading">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

const ROLE_RANK: Record<string, number> = { viewer: 0, editor: 1, admin: 2 };

export function RequireRole({ minimum, children }: { minimum: "editor" | "admin"; children: ReactNode }) {
  const { user } = useAuth();
  if (!user || ROLE_RANK[user.role] < ROLE_RANK[minimum]) return null;
  return <>{children}</>;
}
