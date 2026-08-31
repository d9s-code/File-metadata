import { Link, NavLink } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { ThemeToggle } from "./ThemeToggle";

export function NavBar() {
  const { user, logout } = useAuth();

  return (
    <nav className="navbar">
      <div className="navbar-brand">
        <Link to="/dashboard">RF Emitter Profile Manager</Link>
      </div>
      {user && (
        <div className="navbar-links">
          <NavLink to="/dashboard" className={({ isActive }) => (isActive ? "navbar-link-active" : undefined)}>
            Dashboard
          </NavLink>
          <NavLink
            to="/emitters"
            className={({ isActive }) => (isActive ? "navbar-link-active" : undefined)}
          >
            Emitters
          </NavLink>
          <NavLink
            to="/platforms"
            className={({ isActive }) => (isActive ? "navbar-link-active" : undefined)}
          >
            Platforms
          </NavLink>
          <NavLink to="/mdfs" className={({ isActive }) => (isActive ? "navbar-link-active" : undefined)}>
            MDFs
          </NavLink>
          <NavLink
            to="/audit-log"
            className={({ isActive }) => (isActive ? "navbar-link-active" : undefined)}
          >
            Audit Log
          </NavLink>
          <NavLink to="/help" className={({ isActive }) => (isActive ? "navbar-link-active" : undefined)}>
            Help
          </NavLink>
        </div>
      )}
      {!user && <div className="navbar-links" />}
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
