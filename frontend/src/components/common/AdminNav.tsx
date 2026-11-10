import { NavLink } from "react-router-dom";
import { BuildLabel } from "./BuildLabel";
import { STANDALONE } from "../../api/offline";

export function AdminNav() {
  return (
    <div className="tab-bar">
      <NavLink to="/admin/users" className={({ isActive }) => (isActive ? "tab active" : "tab")}>
        Users
      </NavLink>
      <NavLink to="/admin/checkouts" className={({ isActive }) => (isActive ? "tab active" : "tab")}>
        Edit locks
      </NavLink>
      <NavLink to="/admin/trash" className={({ isActive }) => (isActive ? "tab active" : "tab")}>
        Recently Deleted
      </NavLink>
      <NavLink to="/admin/backups" className={({ isActive }) => (isActive ? "tab active" : "tab")}>
        Backups
      </NavLink>
      <NavLink to="/admin/statuses" className={({ isActive }) => (isActive ? "tab active" : "tab")}>
        Statuses &amp; milestones
      </NavLink>
      <NavLink to="/admin/defaults" className={({ isActive }) => (isActive ? "tab active" : "tab")}>
        Defaults
      </NavLink>
      <NavLink to="/admin/function-codes" className={({ isActive }) => (isActive ? "tab active" : "tab")}>
        Function codes
      </NavLink>
      <NavLink to="/admin/settings" className={({ isActive }) => (isActive ? "tab active" : "tab")}>
        Settings
      </NavLink>
      {STANDALONE && (
        <NavLink to="/admin/sync" className={({ isActive }) => (isActive ? "tab active" : "tab")}>
          Sync
        </NavLink>
      )}
      <BuildLabel />
    </div>
  );
}
