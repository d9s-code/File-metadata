import { useEffect, useRef, useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { RequireRole } from "../../auth/RequireAuth";
import { ThemeToggle } from "./ThemeToggle";
import { MenuButton } from "./MenuButton";
import { ChangePasswordModal } from "./ChangePasswordModal";
import { SettingsModal } from "./SettingsModal";
import { useMyWork } from "../../state/hooks/useTasks";
import { QuickJump } from "./QuickJump";

/** The top menu. Pages that belong under an item (Source Groups under
 * Emitters, Customers under MDFs) are tabs on its pages and light it up. */
const LINKS: { to: string; label: string; also?: string[] }[] = [
  { to: "/dashboard", label: "Dashboard" },
  { to: "/emitters", label: "Emitters", also: ["/source-groups", "/ambiguity/emitter"] },
  { to: "/platforms", label: "Platforms", also: ["/ambiguity/platform"] },
  { to: "/mdfs", label: "MDFs", also: ["/customers", "/dwells", "/ambiguity/mdf"] },
  { to: "/intercepts", label: "Intercepts" },
  { to: "/tasks", label: "Tasks" },
];

function isUnder(pathname: string, prefix: string) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function NavBar() {
  const { user, logout } = useAuth();
  const { data: work } = useMyWork(!!user);
  const myTasks = work?.tasks.length ?? 0;
  // On narrow windows the links fold behind a Menu button.
  const [menuOpen, setMenuOpen] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const { pathname } = useLocation();
  useEffect(() => setMenuOpen(false), [pathname]);

  // Publish the bar's height so sticky table headers can sit just under it
  // (it changes with the window width and when the menu folds open).
  const navRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = navRef.current;
    if (!el) return;
    const publish = () =>
      document.documentElement.style.setProperty("--navbar-height", `${el.getBoundingClientRect().height}px`);
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <nav className="navbar" ref={navRef}>
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
            <NavLink
              key={l.to}
              to={l.to}
              className={({ isActive }) =>
                isActive || l.also?.some((p) => isUnder(pathname, p)) ? "navbar-link-active" : undefined
              }
            >
              {l.label}
              {l.to === "/tasks" && myTasks > 0 && (
                <span className="navbar-count" title={`${myTasks} open task${myTasks === 1 ? "" : "s"} for you`}>
                  {myTasks}
                </span>
              )}
            </NavLink>
          ))}
          <RequireRole minimum="admin">
            <NavLink to="/admin/users" className={isUnder(pathname, "/admin") ? "navbar-link-active" : undefined}>
              Admin
            </NavLink>
          </RequireRole>
        </div>
      ) : (
        <div className="navbar-links" />
      )}
      <div className="navbar-user">
        {user && <QuickJump />}
        {user && (
          <NavLink
            to="/help"
            className={({ isActive }) => (isActive ? "navbar-help navbar-link-active" : "navbar-help")}
            title="Help"
            aria-label="Help"
          >
            ?
          </NavLink>
        )}
        <ThemeToggle />
        {user && (
          <>
            <MenuButton
              label={
                <>
                  {user.username} <span className="role-badge">{user.role}</span> ▾
                </>
              }
              className="navbar-account"
              ariaLabel="Your account"
              items={[
                { label: "Audit Log", to: "/audit-log" },
                { label: "Help", to: "/help" },
                { label: "Settings…", onSelect: () => setShowSettings(true) },
                { label: "Change password…", onSelect: () => setChangingPassword(true) },
                { label: "Sign out", onSelect: () => void logout() },
              ]}
            />
            {changingPassword && <ChangePasswordModal onClose={() => setChangingPassword(false)} />}
            {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
          </>
        )}
      </div>
    </nav>
  );
}
