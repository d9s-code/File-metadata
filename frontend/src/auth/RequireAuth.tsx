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

/** Route-level guard for admin-only pages — unlike RequireRole (which just
 * hides a button/element for non-admins), this bounces a non-admin away
 * entirely, since landing on a blank admin page would be confusing. */
export function RequireAdmin({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="page-loading">Loading…</div>;
  if (!user || user.role !== "admin") return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}
