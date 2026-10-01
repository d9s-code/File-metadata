import { useState } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { emittersApi } from "../api/emitters";
import { ApiRequestError } from "../api/client";
import { emittersKey } from "../state/hooks/useEmitters";
import { heldFor, LONG_HELD_MS, useCheckouts } from "../state/hooks/useEmitterCheckout";
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
  const now = Date.now();

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
          without saving a version or discarding anything — what&apos;s live stays live. Held over 8 hours is marked.
        </p>
        {error && <div className="error-text">{error}</div>}
        {isLoading ? (
          <LoadingState label="Loading edit locks…" />
        ) : !checkouts || checkouts.length === 0 ? (
          <EmptyState compact title="No Emitters are being edited" />
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Emitter</th>
                <th>Held by</th>
                <th>Since</th>
                <th>Held for</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {checkouts.map((c) => {
                const long = !!c.checked_out_at && now - Date.parse(c.checked_out_at) > LONG_HELD_MS;
                return (
                  <tr key={c.emitter_id}>
                    <td>
                      <Link to={`/emitters/${c.emitter_id}`}>{c.emitter_name}</Link>
                    </td>
                    <td>{c.checked_out_by_username ?? "—"}</td>
                    <td>{c.checked_out_at ? new Date(c.checked_out_at).toLocaleString() : "—"}</td>
                    <td className={long ? "checkout-held long" : undefined}>
                      {heldFor(c.checked_out_at, now)}
                      {long && " · long-held"}
                    </td>
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
