import { Link } from "react-router-dom";
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
          <Link to="/dashboard">Dashboard</Link>
          <Link to="/emitters">Emitters</Link>
          <Link to="/platforms">Platforms</Link>
          <Link to="/mdfs">MDFs</Link>
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
