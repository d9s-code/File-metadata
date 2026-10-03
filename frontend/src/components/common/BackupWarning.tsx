import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { useBackupHealth } from "../../state/hooks/useBackups";

const DISMISSED_KEY = "backup-warning-dismissed";

function readDismissed(): string | null {
  try {
    return sessionStorage.getItem(DISMISSED_KEY);
  } catch {
    return null;
  }
}

/** A strip under the nav bar, for admins only, when backups aren't in order —
 * no recent backup, a failed verification, the scheduler not running. Hiding
 * it lasts until the browser tab closes, or until the problem changes. */
export function BackupWarning() {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const isAdmin = user?.role === "admin";
  const { data: health } = useBackupHealth(isAdmin);
  const [dismissed, setDismissed] = useState(readDismissed);

  if (!isAdmin || !health || health.ok || pathname === "/admin/backups") return null;
  const key = health.problems.join("|");
  if (dismissed === key) return null;

  function dismiss() {
    setDismissed(key);
    try {
      sessionStorage.setItem(DISMISSED_KEY, key);
    } catch {
      // Storage unavailable — it'll show again on the next page load.
    }
  }

  const [first, ...rest] = health.problems;
  return (
    <div className="backup-warning" role="status">
      <span>
        <strong>⚠ Backups need attention:</strong> {first}
        {rest.length > 0 && ` (and ${rest.length} more)`}
      </span>
      <Link to="/admin/backups">Open Backups</Link>
      <button type="button" className="link-button" onClick={dismiss} aria-label="Hide until this tab is closed">
        Hide
      </button>
    </div>
  );
}
