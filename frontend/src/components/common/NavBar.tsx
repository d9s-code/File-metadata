import { useEffect, useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { RequireRole } from "../../auth/RequireAuth";
import { ThemeToggle } from "./ThemeToggle";

const LINKS: { to: string; label: string }[] = [
  { to: "/dashboard", label: "Dashboard" },
  { to: "/emitters", label: "Emitters" },
  { to: "/platforms", label: "Platforms" },
  { to: "/mdfs", label: "MDFs" },
  { to: "/source-groups", label: "Source Groups" },
  { to: "/customers", label: "Customers" },
  { to: "/intercepts", label: "Intercepts" },
  { to: "/audit-log", label: "Audit Log" },
  { to: "/help", label: "Help" },
];

const linkClass = ({ isActive }: { isActive: boolean }) =>
  isActive ? "navbar-link-active" : undefined;

export function NavBar() {
  const { user, logout } = useAuth();
  // On narrow windows the links fold behind a Menu button.
  const [menuOpen, setMenuOpen] = useState(false);
  const { pathname } = useLocation();
  useEffect(() => setMenuOpen(false), [pathname]);

  return (
    <nav className="navbar">
      <div className="navbar-brand">
        <Link to="/dashboard">PRS Emitter Repo</Link>
      </div>
      {user && (
        <button
          type="button"
          className="navbar-menu-toggle"
          aria-expanded={menuOpen}
          aria-controls="navbar-links"
          onClick={() => setMenuOpen((v) => !v)}
        >
          {menuOpen ? "✕ Close" : "☰ Menu"}
        </button>
      )}
      {user ? (
        <div
          id="navbar-links"
          className={menuOpen ? "navbar-links open" : "navbar-links"}
        >
          {LINKS.map((l) => (
            <NavLink key={l.to} to={l.to} className={linkClass}>
              {l.label}
            </NavLink>
          ))}
          <RequireRole minimum="admin">
            <NavLink to="/admin/users" className={linkClass}>
              Admin
            </NavLink>
          </RequireRole>
        </div>
      ) : (
        <div className="navbar-links" />
      )}
      <div className="navbar-user">
        <ThemeToggle />
        {user && (
          <>
            <span>
              {user.username} <span className="role-badge">{user.role}</span>
            </span>
            <button className="link-button" onClick={() => void logout()}>
              Sign out
            </button>
          </>
        )}
      </div>
    </nav>
  );
}
