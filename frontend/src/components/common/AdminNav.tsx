import { NavLink } from "react-router-dom";

export function AdminNav() {
  return (
    <div className="tab-bar">
      <NavLink to="/admin/users" className={({ isActive }) => (isActive ? "tab active" : "tab")}>
        Users
      </NavLink>
      <NavLink to="/admin/trash" className={({ isActive }) => (isActive ? "tab active" : "tab")}>
        Recently Deleted
      </NavLink>
    </div>
  );
}
