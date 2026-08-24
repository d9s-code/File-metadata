import { Link } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";

export function NavBar() {
  const { user, logout } = useAuth();
  if (!user) return null;

  return (
    <nav className="navbar">
      <div className="navbar-brand">
        <Link to="/emitters">RF Emitter Profile Manager</Link>
      </div>
      <div className="navbar-links">
        <Link to="/emitters">Emitters</Link>
      </div>
      <div className="navbar-user">
        <span>
          {user.username} <span className="role-badge">{user.role}</span>
        </span>
        <button className="link-button" onClick={() => void logout()}>
          Sign out
        </button>
      </div>
    </nav>
  );
}
