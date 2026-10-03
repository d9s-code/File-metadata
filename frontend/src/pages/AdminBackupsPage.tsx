import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { AdminNav } from "../components/common/AdminNav";
import { LoadingState } from "../components/common/LoadingState";
import { EmptyState } from "../components/common/EmptyState";
import { useBackUpNow, useBackupDiff, useBackups, useVerifyBackup } from "../state/hooks/useBackups";
import {
  LIVE_DATA,
  type BackupDiffKind,
  type BackupItem,
  type BackupKind,
  type BackupKindChanges,
  type BackupVerification,
} from "../api/backups";

const KIND_LABELS: Record<BackupKind, string> = {
  scheduled: "Nightly",
  manual: "By hand",
  "before-restore": "Before restore",
  unknown: "—",
};

const DIFF_KINDS: { key: BackupDiffKind; label: string; path: string }[] = [
  { key: "emitters", label: "Emitters", path: "/emitters" },
  { key: "platforms", label: "Platforms", path: "/platforms" },
  { key: "mdfs", label: "MDFs", path: "/mdfs" },
];

/** Listed per section before "Show all". */
const SHOWN = 15;

function when(iso: string | null | undefined) {
  return iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—";
}

/** "3 hours ago", "in 9 hours", "2 days ago". */
function relative(iso: string, now = Date.now()) {
  const minutes = Math.round((Date.parse(iso) - now) / 60_000);
  const abs = Math.abs(minutes);
  const [n, unit] = abs < 60 ? [abs, "minute"] : abs < 48 * 60 ? [Math.round(abs / 60), "hour"] : [Math.round(abs / 1440), "day"];
  if (n === 0) return "just now";
  const text = `${n} ${unit}${n === 1 ? "" : "s"}`;
  return minutes < 0 ? `${text} ago` : `in ${text}`;
}

function size(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[i]}`;
}

function VerificationBadge({ check }: { check: BackupVerification | null }) {
  if (!check) return <span className="status-badge">Not verified</span>;
  const title = `${when(check.at)} — ${check.message}`;
  return check.ok ? (
    <span className="status-badge backup-ok" title={title}>
      Passed
    </span>
  ) : (
    <span className="status-badge backup-failed" title={title}>
      Failed
    </span>
  );
}

/** "2 added · 1 removed · 3 changed", or "No changes". */
function kindCounts(c: BackupKindChanges) {
  const parts = [
    c.added.length > 0 && `${c.added.length} added`,
    c.removed.length > 0 && `${c.removed.length} removed`,
    c.changed.length > 0 && `${c.changed.length} changed`,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "No changes";
}

function DiffSection({ label, path, changes }: { label: string; path: string; changes: BackupKindChanges }) {
  const [showAll, setShowAll] = useState(false);
  const items = [
    ...changes.added.map((a) => ({ kind: "added" as const, id: a.id, name: a.name, lines: a.deleted ? ["In Recently Deleted"] : [] })),
    ...changes.removed.map((r) => ({ kind: "removed" as const, id: r.id, name: r.name, lines: [] as string[] })),
    ...changes.changed.map((c) => ({ kind: "changed" as const, id: c.id, name: c.name, lines: c.changes })),
  ];
  const shown = showAll ? items : items.slice(0, SHOWN);
  return (
    <section className="backup-diff-section">
      <h5>
        {label} <span className="hint-text">{kindCounts(changes)}{changes.unchanged > 0 && ` · ${changes.unchanged} unchanged`}</span>
      </h5>
      {items.length > 0 && (
        <div className="change-list">
          {shown.map((item) => (
            <div key={`${item.kind}-${item.id}`} className={item.kind === "changed" ? "change-group" : `change-group ${item.kind}`}>
              <div className="change-group-head">
                {item.kind === "removed" ? (
                  <strong className="change-item-name">{item.name}</strong>
                ) : (
                  <Link className="change-item-name" to={`${path}/${item.id}`}>
                    {item.name}
                  </Link>
                )}
                {item.kind !== "changed" && (
                  <span className={`change-badge ${item.kind}`}>{item.kind === "added" ? "Added" : "Removed"}</span>
                )}
              </div>
              {item.lines.length > 0 && (
                <ul className="backup-change-lines">
                  {item.lines.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
      {items.length > SHOWN && (
        <button type="button" className="link-button" onClick={() => setShowAll((v) => !v)}>
          {showAll ? "Show fewer" : `Show all ${items.length}`}
        </button>
      )}
    </section>
  );
}

function backupOption(b: BackupItem) {
  return `${when(b.created_at)} · ${KIND_LABELS[b.kind]}${b.has_overview ? "" : " (no overview)"}`;
}

/** Admin → Backups: whether backups are in order, taking one now, checking one
 * restores, and an overview of what changed between two of them — or between
 * one and the current data. Restoring stays a command-line step (see Help). */
export function AdminBackupsPage() {
  const { data, isLoading, error } = useBackups();
  const backUpNow = useBackUpNow();
  const verify = useVerifyBackup();
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string>(LIVE_DATA);
  const compareRef = useRef<HTMLElement>(null);

  const backups = data?.backups ?? [];
  // Start by comparing the latest backup that has an overview with the current data.
  useEffect(() => {
    if (from === null) {
      const first = backups.find((b) => b.has_overview);
      if (first) setFrom(first.file);
    }
  }, [backups, from]);
  const diff = useBackupDiff(from, to);

  function compareWithCurrent(file: string) {
    setFrom(file);
    setTo(LIVE_DATA);
    compareRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const health = data?.health;
  const scheduler = health?.scheduler;
  const actionError = (backUpNow.error ?? verify.error) as Error | null;

  return (
    <div className="page">
      <h1>Admin</h1>
      <AdminNav />
      {error && <div className="error-text">{(error as Error).message}</div>}
      {isLoading || !data || !health ? (
        <LoadingState label="Loading backups…" />
      ) : (
        <>
          <section className={health.ok ? "card backup-status ok" : "card backup-status problem"}>
            <div className="backup-status-head">
              <h4>{health.ok ? "✓ Backups are in order" : "⚠ Backups need attention"}</h4>
              <button type="button" disabled={backUpNow.isPending} onClick={() => backUpNow.mutate()}>
                {backUpNow.isPending ? "Backing up…" : "Back up now"}
              </button>
            </div>
            {!health.ok && (
              <ul className="backup-problems">
                {health.problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            )}
            {actionError && <div className="error-text">{actionError.message}</div>}
            <dl className="backup-facts">
              <div>
                <dt>Latest backup</dt>
                <dd>{health.latest_backup_at ? `${when(health.latest_backup_at)} (${relative(health.latest_backup_at)})` : "None yet"}</dd>
              </div>
              <div>
                <dt>Last verification</dt>
                <dd>
                  {health.last_verification ? (
                    <>
                      <VerificationBadge check={health.last_verification} /> {when(health.last_verification.at)}
                    </>
                  ) : (
                    "Never"
                  )}
                </dd>
              </div>
              <div>
                <dt>Next nightly backup</dt>
                <dd>
                  {scheduler?.next_run_at ? `${when(scheduler.next_run_at)} (${relative(scheduler.next_run_at)})` : "Scheduler not reporting"}
                </dd>
              </div>
              <div>
                <dt>Second copy</dt>
                <dd>{health.copy_dir ? health.copy_dir : "Not set up"}</dd>
              </div>
            </dl>
            <p className="hint-text">
              Every night a backup is taken, then restored into a scratch database to prove it works; old ones are thinned
              out to 14 daily, 8 weekly and 6 monthly. Restoring one is done from the server&apos;s command line — see{" "}
              <Link to="/help#admin-backups">Help</Link>.
            </p>
          </section>

          <section className="card">
            <div className="card-header">
              <h4>
                Backups <span className="section-count">{backups.length}</span>
              </h4>
            </div>
            {backups.length === 0 ? (
              <EmptyState compact title="No backups yet" message="Take one with Back up now, or wait for the nightly one." />
            ) : (
              <div className="backup-table-wrap">
                <table className="data-table backup-table">
                  <thead>
                    <tr>
                      <th>Taken</th>
                      <th>Kind</th>
                      <th>Size</th>
                      <th className="num">Emitters</th>
                      <th className="num">Platforms</th>
                      <th className="num">MDFs</th>
                      <th>Verified</th>
                      {health.copy_dir && <th>Second copy</th>}
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="backup-live-row">
                      <td>Current data</td>
                      <td />
                      <td />
                      <td className="num">{data.live.emitters}</td>
                      <td className="num">{data.live.platforms}</td>
                      <td className="num">{data.live.mdfs}</td>
                      <td />
                      {health.copy_dir && <td />}
                      <td />
                    </tr>
                    {backups.map((b) => (
                      <tr key={b.file}>
                        <td title={b.file}>{when(b.created_at)}</td>
                        <td>
                          {KIND_LABELS[b.kind]}
                          {b.created_by && b.kind !== "scheduled" && <span className="hint-text"> · {b.created_by}</span>}
                        </td>
                        <td>{size(b.size_bytes)}</td>
                        <td className="num">{b.summary?.emitters ?? "—"}</td>
                        <td className="num">{b.summary?.platforms ?? "—"}</td>
                        <td className="num">{b.summary?.mdfs ?? "—"}</td>
                        <td>
                          <VerificationBadge check={b.verification} />
                        </td>
                        {health.copy_dir && <td>{b.copied_to ? "✓" : <span className="error-text">Missing</span>}</td>}
                        <td className="backup-actions">
                          <button
                            type="button"
                            className="button secondary small"
                            disabled={verify.isPending}
                            title="Restore it into the scratch database and check it's complete"
                            onClick={() => verify.mutate(b.file)}
                          >
                            {verify.isPending && verify.variables === b.file ? "Verifying…" : "Verify"}
                          </button>
                          <button
                            type="button"
                            className="link-button"
                            disabled={!b.has_overview}
                            title={b.has_overview ? "What changed since this backup" : "Made before backups kept an overview — verify it once to fill one in"}
                            onClick={() => compareWithCurrent(b.file)}
                          >
                            Compare with now
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="card" ref={compareRef}>
            <div className="card-header">
              <h4>Compare</h4>
            </div>
            <p className="hint-text">
              What changed between two backups, or between a backup and the current data — Emitters, Platforms and MDFs added,
              removed or changed, and for each changed one what changed: name, status, Modes, saved version, pins.
            </p>
            {backups.length === 0 ? (
              <EmptyState compact title="Nothing to compare yet" />
            ) : (
              <>
                <div className="backup-compare-pickers">
                  <label>
                    From
                    <select value={from ?? ""} onChange={(e) => setFrom(e.target.value)}>
                      {from === null && <option value="">Choose a backup…</option>}
                      {backups.map((b) => (
                        <option key={b.file} value={b.file} disabled={!b.has_overview}>
                          {backupOption(b)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <span className="change-arrow" aria-hidden="true">
                    →
                  </span>
                  <label>
                    To
                    <select value={to} onChange={(e) => setTo(e.target.value)}>
                      <option value={LIVE_DATA}>Current data</option>
                      {backups.map((b) => (
                        <option key={b.file} value={b.file} disabled={!b.has_overview}>
                          {backupOption(b)}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                {from !== null && from === to ? (
                  <p className="hint-text">Pick two different backups.</p>
                ) : diff.isLoading ? (
                  <LoadingState label="Comparing…" />
                ) : diff.error ? (
                  <div className="error-text">{(diff.error as Error).message}</div>
                ) : diff.data ? (
                  <div className="backup-diff">
                    {DIFF_KINDS.map((k) => (
                      <DiffSection key={k.key} label={k.label} path={k.path} changes={diff.data.changes[k.key]} />
                    ))}
                  </div>
                ) : null}
              </>
            )}
          </section>
        </>
      )}
    </div>
  );
}
