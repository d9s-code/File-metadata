import { useState, type FormEvent } from "react";
import { Modal } from "../common/Modal";
import { StatusBadge } from "../status/StatusBadge";
import { usePinCandidates, usePinEmitter } from "../../state/hooks/usePlatforms";
import { ApiRequestError } from "../../api/client";
import type { PinCandidate } from "../../api/platforms";

/** Pick any number of Emitters, found by designation or name, and pin each at
 * its latest saved version in one go. Ones already pinned are shown, not
 * offered again; ones never saved can't be pinned yet. */
export function PinEmittersDialog({ platformId, onClose }: { platformId: string; onClose: () => void }) {
  const { data: candidates, isLoading } = usePinCandidates(platformId);
  const pin = usePinEmitter(platformId);
  const [filter, setFilter] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  const words = filter.toLowerCase().split(/\s+/).filter(Boolean);
  const matches = (c: PinCandidate) =>
    words.every((w) => c.name.toLowerCase().includes(w) || (c.designation ?? "").toLowerCase().includes(w));
  const shown = (candidates ?? []).filter(matches);
  const pinnable = (c: PinCandidate) => c.pinned_version_number === null && c.latest_version_number !== null;
  const shownPinnable = shown.filter(pinnable);
  const allShownPicked = shownPinnable.length > 0 && shownPinnable.every((c) => picked.has(c.emitter_id));

  function toggle(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleShown() {
    setPicked((prev) => {
      const next = new Set(prev);
      for (const c of shownPinnable) {
        if (allShownPicked) next.delete(c.emitter_id);
        else next.add(c.emitter_id);
      }
      return next;
    });
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const failed: string[] = [];
    for (const c of (candidates ?? []).filter((c) => picked.has(c.emitter_id))) {
      try {
        await pin.mutateAsync({ emitterId: c.emitter_id });
      } catch (err) {
        failed.push(`${c.name}: ${err instanceof ApiRequestError ? err.message : "couldn't be pinned"}`);
      }
    }
    setBusy(false);
    if (failed.length) setErrors(failed);
    else onClose();
  }

  return (
    <Modal title="Pin Emitters" onClose={onClose} wide>
      <form className="pin-emitters" onSubmit={submit}>
        <input
          type="search"
          placeholder="Find by designation or name…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          autoFocus
          aria-label="Find Emitters"
        />
        {isLoading ? (
          <p className="hint-text">Loading…</p>
        ) : shown.length === 0 ? (
          <p className="hint-text">No Emitter matches.</p>
        ) : (
          <>
            {shownPinnable.length > 1 && (
              <label className="checkbox-label pin-emitters-all">
                <input type="checkbox" checked={allShownPicked} onChange={toggleShown} />
                {allShownPicked ? "Untick" : "Tick"} all {shownPinnable.length} shown
              </label>
            )}
            <ul className="pin-emitters-list">
              {shown.map((c) => {
                const pinned = c.pinned_version_number !== null;
                const unsaved = c.latest_version_number === null;
                return (
                  <li key={c.emitter_id} className={pinned || unsaved ? "muted" : undefined}>
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={pinned || picked.has(c.emitter_id)}
                        disabled={pinned || unsaved}
                        onChange={() => toggle(c.emitter_id)}
                      />
                      <span className="pin-emitters-name">
                        {c.designation && <strong>{c.designation}</strong>} {c.name}
                      </span>
                      <StatusBadge type="emitter" status={c.status} />
                      <span className="hint-text pin-emitters-version">
                        {pinned
                          ? `pinned at v${c.pinned_version_number}`
                          : unsaved
                            ? "no saved version yet"
                            : `v${c.latest_version_number}`}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </>
        )}
        {errors.length > 0 && (
          <div className="error-text" role="alert">
            {errors.map((m) => (
              <div key={m}>{m}</div>
            ))}
          </div>
        )}
        <div className="modal-actions">
          <span className="hint-text">Each is pinned at its latest saved version; change it in the table after.</span>
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button primary" disabled={busy || picked.size === 0}>
            {busy ? "Pinning…" : picked.size > 1 ? `Pin ${picked.size} Emitters` : "Pin Emitter"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
