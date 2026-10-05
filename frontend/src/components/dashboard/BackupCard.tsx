import { Link } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { useBackUpNow, useBackupStatus } from "../../state/hooks/useBackups";
import { backupWhen, duration, relativeTime } from "../common/backupFormat";
import type { BackupDiffKind, BackupFreshness, FreshnessLevel } from "../../api/backups";

const LEVEL_LABEL: Record<FreshnessLevel, string> = {
  ok: "Up to date",
  due: "Backup due",
  overdue: "Backup overdue",
  none: "No backup yet",
};

const KINDS: { key: BackupDiffKind; label: string; path: string }[] = [
  { key: "emitters", label: "Emitters", path: "/emitters" },
  { key: "platforms", label: "Platforms", path: "/platforms" },
  { key: "mdfs", label: "MDFs", path: "/mdfs" },
];

/** "Due in 2 days at this rate", "Due 5 hours ago", "Nothing has changed since". */
function dueLine(f: BackupFreshness) {
  if (f.level === "none") return "Nothing is backed up yet — everything would be lost with the server.";
  if (!f.due_at || f.age_hours === null || f.due_after_hours === null) return "Nothing has changed since — no backup needed.";
  const past = f.age_hours - f.due_after_hours;
  if (past < 0) return `Due in ${duration(-past)} at this rate of change.`;
  return `Due ${duration(past)} ago — ${f.changes} changes would be lost with the server.`;
}

function kindLine(k: { added: number; removed: number; changed: number }) {
  return (
    [k.added > 0 && `${k.added} added`, k.changed > 0 && `${k.changed} changed`, k.removed > 0 && `${k.removed} removed`]
      .filter(Boolean)
      .join(" · ") || "No changes"
  );
}

/** Time since the latest backup and what's changed since. The alert scales with
 * the changes: the more there are, the sooner a backup is due (see Help). */
export function BackupCard() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const { data: f, error } = useBackupStatus();
  const backUpNow = useBackUpNow();

  if (error) return null;
  if (!f) return <div className="card backup-card" />;

  const fill = f.level === "none" || f.level === "overdue" ? 1 : f.due_after_hours && f.age_hours !== null ? Math.min(1, f.age_hours / f.due_after_hours) : 0;
  const touched = f.kinds ? KINDS.filter((k) => kindLine(f.kinds![k.key]) !== "No changes") : [];
  const named = f.kinds ? KINDS.flatMap((k) => f.kinds![k.key].named.map((n) => ({ ...n, path: k.path }))).slice(0, 6) : [];

  return (
    <div className={`card backup-card level-${f.level}`}>
      <div className="dashboard-card-header">
        <h4>Backup</h4>
        <span className={`backup-level level-${f.level}`}>{LEVEL_LABEL[f.level]}</span>
      </div>

      <div className="backup-card-stats">
        <div>
          <span className="backup-card-figure">{f.age_hours === null ? "—" : duration(f.age_hours)}</span>
          <span className="hint-text">
            {f.latest_backup_at ? <span title={backupWhen(f.latest_backup_at)}>since the last backup</span> : "never backed up"}
          </span>
        </div>
        <div>
          <span className="backup-card-figure">{f.changes ?? "—"}</span>
          <span className="hint-text">changes since</span>
        </div>
      </div>

      {f.level !== "none" && f.due_after_hours !== null && (
        <div className="progress-bar-track backup-card-meter" aria-hidden="true">
          <div className={`progress-bar-fill level-${f.level}`} style={{ width: `${Math.max(3, fill * 100)}%` }} />
        </div>
      )}
      <p className={f.level === "ok" ? "backup-card-due" : "backup-card-due alert"}>{dueLine(f)}</p>

      {f.kinds && (f.changes ?? 0) > 0 && (
        touched.length > 0 ? (
          <dl className="backup-card-kinds">
            {touched.map((k) => (
              <div key={k.key}>
                <dt>{k.label}</dt>
                <dd>{kindLine(f.kinds![k.key])}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="hint-text">
            No Emitter, Platform or MDF added, removed, renamed or saved as a new version since — the changes are edits
            inside them.
          </p>
        )
      )}
      {named.length > 0 && (
        <ul className="backup-card-named">
          {named.map((n) => (
            <li key={`${n.path}-${n.id}`}>
              {n.how === "removed" ? <span>{n.name}</span> : <Link to={`${n.path}/${n.id}`}>{n.name}</Link>}{" "}
              <span className="hint-text">{n.how}</span>
            </li>
          ))}
        </ul>
      )}

      <p className="hint-text backup-card-next">
        {f.next_scheduled_at
          ? `Next automatic backup ${relativeTime(f.next_scheduled_at)}.`
          : "The automatic backup scheduler isn't reporting."}
      </p>

      {isAdmin ? (
        <div className="backup-card-actions">
          <button type="button" disabled={backUpNow.isPending} onClick={() => backUpNow.mutate()}>
            {backUpNow.isPending ? "Backing up…" : "Back up now"}
          </button>
          <Link to="/admin/backups">Backups &amp; what changed</Link>
          {backUpNow.error && <span className="error-text">{(backUpNow.error as Error).message}</span>}
        </div>
      ) : (
        f.level !== "ok" && <p className="hint-text">An admin can back up from Admin → Backups.</p>
      )}
    </div>
  );
}
