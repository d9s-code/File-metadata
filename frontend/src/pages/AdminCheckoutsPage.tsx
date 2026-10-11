import { useState } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { emittersApi } from "../api/emitters";
import { ApiRequestError } from "../api/client";
import { emittersKey } from "../state/hooks/useEmitters";
import { heldFor, LONG_HELD_MS, releasesIn, useCheckouts } from "../state/hooks/useEmitterCheckout";
import { AdminNav } from "../components/common/AdminNav";
import { LoadingState } from "../components/common/LoadingState";
import { EmptyState } from "../components/common/EmptyState";
import { useConfirmDialog } from "../components/common/ConfirmDialog";
import type { EmitterCheckout } from "../api/emitters";

/** Every Emitter someone is holding for editing, longest-held first, with a
 * Force release for a lock that's blocking others. */
export function AdminCheckoutsPage() {
  const { data: checkouts, isLoading } = useCheckouts();
  const qc = useQueryClient();
  const { confirmDelete, dialog } = useConfirmDialog();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState<string | null>(null);
  const now = Date.now();

  async function releaseSelected() {
    setError(null);
    setNotice(null);
    const ids = [...selected];
    if (
      !(await confirmDelete(
        `Release ${ids.length} edit lock${ids.length === 1 ? "" : "s"}? Unsaved changes stay live but are no longer the holder's to save — anyone can then start editing.`,
        { confirmLabel: "Release" },
      ))
    )
      return;
    setBusy("bulk");
    try {
      const result = await emittersApi.bulk({ emitter_ids: ids, action: "release" });
      setNotice(`${result.done} released${result.skipped ? `, ${result.skipped} skipped` : ""}.`);
      setSelected(new Set());
      await qc.invalidateQueries({ queryKey: emittersKey });
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Couldn't release them");
    } finally {
      setBusy(null);
    }
  }

  async function release(c: EmitterCheckout) {
    setError(null);
    if (
      !(await confirmDelete(
        `Release ${c.checked_out_by_username ?? "this user"}'s hold on ${c.emitter_name}? Their unsaved changes stay live but are no longer theirs to save — anyone can then start editing.`,
        { confirmLabel: "Force release" },
      ))
    )
      return;
    setBusy(c.emitter_id);
    try {
      await emittersApi.checkin(c.emitter_id);
      await qc.invalidateQueries({ queryKey: emittersKey });
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Couldn't release it");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="page">
      <h1>Admin</h1>
      <AdminNav />
      <section className="card">
        <div className="card-header">
          <h4>
            Edit locks <span className="section-count">{checkouts?.length ?? 0}</span>
          </h4>
        </div>
        <p className="hint-text">
          Emitters being edited right now. While one is held, nobody else can edit it. Force release ends the hold
          without saving a version or discarding anything — what&apos;s live stays live. Held over 8 hours is marked; a
          lock its holder hasn&apos;t changed anything under for days is marked <strong>untouched</strong> and released
          on its own after the number of days the server is set to (CHECKOUT_RELEASE_DAYS).
        </p>
        {checkouts && checkouts.length > 0 && (
          <div className="form-row">
            <button
              type="button"
              className="button secondary small"
              onClick={() => setSelected(new Set(checkouts.filter((c) => c.stale).map((c) => c.emitter_id)))}
              disabled={!checkouts.some((c) => c.stale)}
            >
              Select the untouched ones
            </button>
            <button
              type="button"
              className="button danger-outline small"
              disabled={selected.size === 0 || busy === "bulk"}
              onClick={() => void releaseSelected()}
            >
              {busy === "bulk" ? "Releasing…" : `Release selected (${selected.size})`}
            </button>
          </div>
        )}
        {notice && <p className="hint-text">{notice}</p>}
        {error && <div className="error-text">{error}</div>}
        {isLoading ? (
          <LoadingState label="Loading edit locks…" />
        ) : !checkouts || checkouts.length === 0 ? (
          <EmptyState compact title="No Emitters are being edited" />
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th className="select-col">
                  <input
                    type="checkbox"
                    aria-label="Select all"
                    checked={checkouts.length > 0 && checkouts.every((c) => selected.has(c.emitter_id))}
                    onChange={(e) => setSelected(e.target.checked ? new Set(checkouts.map((c) => c.emitter_id)) : new Set())}
                  />
                </th>
                <th>Emitter</th>
                <th>Held by</th>
                <th>Since</th>
                <th>Held for</th>
                <th>Last change</th>
                <th>Auto-release</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {checkouts.map((c) => {
                const long = !!c.checked_out_at && now - Date.parse(c.checked_out_at) > LONG_HELD_MS;
                return (
                  <tr key={c.emitter_id} className={selected.has(c.emitter_id) ? "selected-row" : undefined}>
                    <td className="select-col">
                      <input
                        type="checkbox"
                        aria-label={`Select ${c.emitter_name}`}
                        checked={selected.has(c.emitter_id)}
                        onChange={() =>
                          setSelected((prev) => {
                            const next = new Set(prev);
                            if (next.has(c.emitter_id)) next.delete(c.emitter_id);
                            else next.add(c.emitter_id);
                            return next;
                          })
                        }
                      />
                    </td>
                    <td>
                      <Link to={`/emitters/${c.emitter_id}`}>{c.emitter_name}</Link>
                    </td>
                    <td>{c.checked_out_by_username ?? "—"}</td>
                    <td>{c.checked_out_at ? new Date(c.checked_out_at).toLocaleString() : "—"}</td>
                    <td className={long ? "checkout-held long" : undefined}>
                      {heldFor(c.checked_out_at, now)}
                      {long && " · long-held"}
                    </td>
                    <td className={c.stale ? "checkout-held long" : undefined}>
                      {c.last_activity_at ? `${heldFor(c.last_activity_at, now)} ago` : "—"}
                      {c.stale && " · untouched"}
                    </td>
                    <td>{releasesIn(c.releases_at, now) ?? "never"}</td>
                    <td>
                      <button
                        type="button"
                        className="button danger-outline small"
                        disabled={busy === c.emitter_id}
                        onClick={() => void release(c)}
                      >
                        Force release
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
      {dialog}
    </div>
  );
}
