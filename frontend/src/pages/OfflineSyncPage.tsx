import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiRequestError } from "../api/client";
import { offlineApi, type Resolutions, type SyncGroup, type SyncPreview, type SyncResult } from "../api/offline";
import { useAuth } from "../auth/AuthContext";
import { useHasRole } from "../auth/RequireAuth";
import { useConfirmDialog } from "../components/common/ConfirmDialog";
import { AdminNav } from "../components/common/AdminNav";
import { PageHeader } from "../components/common/PageHeader";
import { formatDateTime } from "../components/common/dates";

const TABLE_LABELS: Record<string, string> = {
  emitters: "Emitters",
  ew_groups: "EW Groups",
  sources: "Sources",
  modes: "Modes",
  mode_lines: "Mode lines",
  mode_elements: "Elements",
  parameter_sequences: "Sequences",
  emitter_versions: "Emitter versions",
  emitter_checkpoints: "Checkpoints",
  platforms: "Platforms",
  platform_emitter_links: "Platform pins",
  mdfs: "MDFs",
  mdf_platform_links: "MDF pins",
  test_records: "Test runs",
  test_record_lines: "Test run lines",
  test_lines: "SIM Test Lines",
  intercepts: "Intercepts",
  dwell_files: "Dwell files",
  dwell_strategies: "Dwell Strategies",
};

const CONFLICT_TEXT: Record<string, string> = {
  field: "Changed differently on each side",
  server_deleted: "Changed on this PC, deleted on the server",
  pc_deleted: "Deleted on this PC, changed on the server",
  parent_deleted: "Added on this PC under something the server has deleted",
};

function show(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function count(summary: Partial<Record<string, number>>): string {
  const parts = [
    summary.insert ? `${summary.insert} added` : null,
    summary.update ? `${summary.update} changed` : null,
    summary.delete ? `${summary.delete} deleted` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : "nothing";
}

/** The standalone app's link back to the server: what has changed on this PC,
 * signing in to the server, checking for conflicts, and syncing. */
export function OfflineSyncPage() {
  const { user } = useAuth();
  const canSync = useHasRole("admin");
  const queryClient = useQueryClient();
  const { confirmDelete, dialog } = useConfirmDialog();
  const { data: status, refetch: refetchStatus } = useQuery({ queryKey: ["offline", "status"], queryFn: offlineApi.status });
  const { data: changes, refetch: refetchChanges, isLoading: changesLoading } = useQuery({
    queryKey: ["offline", "changes"],
    queryFn: offlineApi.changes,
  });

  const [serverUrl, setServerUrl] = useState<string | null>(null);
  const [username, setUsername] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [preview, setPreview] = useState<SyncPreview | null>(null);
  const [choices, setChoices] = useState<Resolutions>({});
  const [result, setResult] = useState<SyncResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const connected = status?.connected_as;
  const conflicted = (preview?.groups ?? []).filter((g) => g.conflicts.length > 0);
  const open = conflicted.filter((g) => !choices[g.key]);

  async function run<T>(what: string, fn: () => Promise<T>): Promise<T | undefined> {
    setBusy(what);
    setError(null);
    try {
      return await fn();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : `${what} failed`);
      return undefined;
    } finally {
      setBusy(null);
      void refetchStatus();
    }
  }

  async function connect(e: FormEvent) {
    e.preventDefault();
    const ok = await run("Signing in", () =>
      offlineApi.connect({
        server_url: (serverUrl ?? status?.server_url ?? "").trim(),
        username: username ?? user?.username ?? "",
        password,
      }),
    );
    if (ok) setPassword("");
  }

  async function check() {
    setResult(null);
    const p = await run("Checking against the server", () => offlineApi.preview(choices));
    if (p) setPreview(p);
  }

  async function sync() {
    const r = await run("Syncing", () => offlineApi.sync(choices));
    if (r) {
      setResult(r);
      setPreview(null);
      setChoices({});
      // Everything on the PC is the server's copy now.
      await queryClient.invalidateQueries();
      void refetchChanges();
    }
  }

  async function fetchAgain() {
    const pending = changes?.total ?? 0;
    if (
      pending > 0 &&
      !(await confirmDelete(
        `This PC has ${pending} change(s) the server doesn't have. Fetching replaces everything here with the server's copy, and they're gone from the app (a file with them is kept in the app's folder). Sync instead to keep them.`,
        { confirmLabel: "Fetch anyway", danger: true },
      ))
    )
      return;
    const r = await run("Fetching", () => offlineApi.fetch(pending > 0));
    if (r) {
      setPreview(null);
      await queryClient.invalidateQueries();
      void refetchChanges();
    }
  }

  return (
    <div className="page">
      <PageHeader
        title="Admin"
        info="Sync: this is the offline version of the app, on this PC. Work here as usual; when you're connected to the server again, sync: your changes go to the server and the server's come here. Where the same thing was changed differently on both sides, you choose which to keep."
      />
      <AdminNav />
      {error && <div className="card error-text">{error}</div>}
      {result && (
        <div className="card success-text">
          Synced: {count(result.applied)} on the server. This PC now has the server&apos;s copy (
          {result.fetched_rows.toLocaleString()} rows).
          {result.notes.length > 0 && (
            <ul>
              {result.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="offline-grid">
        <section className="card">
          <h2 className="as-h4">This PC</h2>
          <dl className="offline-facts">
            <dt>Copy fetched</dt>
            <dd>
              {formatDateTime(status?.fetched_at)}
              {status?.fetched_by ? ` by ${status.fetched_by}` : ""}
            </dd>
            <dt>Last synced</dt>
            <dd>{formatDateTime(status?.synced_at, "Not yet")}</dd>
            <dt>Server</dt>
            <dd>{status?.server_url ?? "—"}</dd>
            <dt>This PC</dt>
            <dd>{status?.device}</dd>
          </dl>
        </section>

        <section className="card">
          <h2 className="as-h4">Server</h2>
          {connected ? (
            <>
              <p>
                Signed in to <strong>{status?.server_url}</strong> as <strong>{connected}</strong>.
              </p>
              <div className="form-row">
                <button className="button secondary small" disabled={!!busy} onClick={() => void run("Signing out", offlineApi.disconnect)}>
                  Sign out of the server
                </button>
                {canSync && (
                  <button className="button secondary small" disabled={!!busy} onClick={() => void fetchAgain()}>
                    Fetch a fresh copy…
                  </button>
                )}
              </div>
            </>
          ) : (
            <form className="offline-connect" onSubmit={(e) => void connect(e)}>
              <p className="hint-text">Connected to the server&apos;s network? Sign in to it to sync.</p>
              <label>
                Server address
                <input value={serverUrl ?? status?.server_url ?? ""} onChange={(e) => setServerUrl(e.target.value)} required />
              </label>
              <label>
                Username
                <input value={username ?? user?.username ?? ""} onChange={(e) => setUsername(e.target.value)} required />
              </label>
              <label>
                Password
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
              </label>
              <button type="submit" disabled={!!busy || !canSync}>
                {busy === "Signing in" ? "Signing in…" : "Sign in to the server"}
              </button>
              {!canSync && <p className="hint-text">Syncing needs an Admin.</p>}
            </form>
          )}
        </section>
      </div>

      <section className="card">
        <div className="card-header">
          <h2 className="as-h4">
            Changes on this PC <span className="hint-text">{changes ? changes.total : ""}</span>
          </h2>
          {connected && canSync && (
            <div className="section-actions">
              <button className="button secondary small" disabled={!!busy} onClick={() => void check()}>
                {busy === "Checking against the server" ? "Checking…" : "Check against the server"}
              </button>
            </div>
          )}
        </div>
        {changesLoading ? (
          <p className="hint-text">Working out what changed…</p>
        ) : !changes || changes.total === 0 ? (
          <p className="hint-text">Nothing changed on this PC since the copy was fetched.</p>
        ) : (
          <>
            <p>
              {Object.entries(changes.per_table)
                .map(([t, n]) => `${n} ${TABLE_LABELS[t] ?? t.replaceAll("_", " ")}`)
                .join(" · ")}
            </p>
            {changes.entries.length > 0 && (
              <details>
                <summary className="hint-text">What was done here ({changes.entries.length})</summary>
                <ul className="offline-entries">
                  {changes.entries.map((e, i) => (
                    <li key={i}>
                      <span className="hint-text">{formatDateTime(e.at)}</span> {e.summary}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </>
        )}
      </section>

      {preview && (
        <section className="card">
          <h2 className="as-h4">Syncing would</h2>
          <p>
            Put {count(preview.summary)} on the server
            {conflicted.length > 0 &&
              ` — and ${conflicted.length} thing${conflicted.length === 1 ? " was" : "s were"} changed on both sides: choose which to keep.`}
          </p>
          {preview.notes.length > 0 && (
            <ul className="hint-text">
              {preview.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          )}
          {conflicted.map((g) => (
            <ConflictGroup
              key={g.key}
              group={g}
              choice={choices[g.key]}
              onChoose={(side) => setChoices((c) => ({ ...c, [g.key]: side }))}
            />
          ))}
          <div className="form-row">
            <button disabled={!!busy || open.length > 0} onClick={() => void sync()}>
              {busy === "Syncing" ? "Syncing…" : "Sync"}
            </button>
            {open.length > 0 && <span className="hint-text">Choose for {open.length} more first.</span>}
          </div>
          <p className="hint-text">
            Changes without a conflict go in either way. After syncing, this PC fetches the server&apos;s copy, so you
            have everyone&apos;s changes.
          </p>
        </section>
      )}
      {dialog}
    </div>
  );
}

function ConflictGroup({
  group,
  choice,
  onChoose,
}: {
  group: SyncGroup;
  choice: "server" | "pc" | undefined;
  onChoose: (side: "server" | "pc") => void;
}) {
  return (
    <div className="card sync-conflict">
      <div className="card-header">
        <h2 className="as-h4">
          <span className="hint-text">{group.kind}</span> {group.label}
        </h2>
        <div className="sync-choice" role="radiogroup" aria-label={`Which to keep for ${group.label}`}>
          <label>
            <input type="radio" checked={choice === "server"} onChange={() => onChoose("server")} /> Keep the server&apos;s
          </label>
          <label>
            <input type="radio" checked={choice === "pc"} onChange={() => onChoose("pc")} /> Keep this PC&apos;s
          </label>
        </div>
      </div>
      <ul>
        {group.conflicts.map((c, i) => (
          <li key={i}>
            <strong>{TABLE_LABELS[c.table] ?? c.table.replaceAll("_", " ")}</strong>: {c.note || CONFLICT_TEXT[c.kind]}
            {c.fields.length > 0 && (
              <table className="data-table sync-fields">
                <thead>
                  <tr>
                    <th>Field</th>
                    <th>When fetched</th>
                    <th>Server</th>
                    <th>This PC</th>
                  </tr>
                </thead>
                <tbody>
                  {c.fields.map((f) => (
                    <tr key={f.name}>
                      <td>{f.name.replaceAll("_", " ")}</td>
                      <td>{show(f.base)}</td>
                      <td className={choice === "server" ? "sync-kept" : undefined}>{show(f.server)}</td>
                      <td className={choice === "pc" ? "sync-kept" : undefined}>{show(f.pc)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
