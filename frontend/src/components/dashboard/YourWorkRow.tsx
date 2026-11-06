import { useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { useMyWork } from "../../state/hooks/useTasks";
import { heldFor, LONG_HELD_MS, useCheckouts } from "../../state/hooks/useEmitterCheckout";

/** What's yours, in one line: your open tasks, the Emitters assigned to you,
 * and the ones you're editing (opened to list them). */
export function YourWorkRow() {
  const { user } = useAuth();
  const { data: work } = useMyWork();
  const { data: checkouts } = useCheckouts(!!user);
  const [open, setOpen] = useState(false);
  const now = Date.now();
  const editing = (checkouts ?? [])
    .filter((c) => c.checked_out_by_id === user?.id)
    .sort((a, b) => (a.checked_out_at ?? "").localeCompare(b.checked_out_at ?? ""));
  const oldest = editing[0]?.checked_out_at ?? null;
  const longHeld = editing.filter((c) => c.checked_out_at && now - Date.parse(c.checked_out_at) > LONG_HELD_MS).length;

  return (
    <div className="card your-work">
      <div className="your-work-strip">
        <Link to="/tasks" className="your-work-item">
          <span className="readout-label">My tasks</span>
          <b className="readout-value">{work?.tasks.length ?? "–"}</b>
          <span className="hint-text">
            {work?.unassigned_open ? `${work.unassigned_open} up for grabs` : work?.tasks.length ? "open" : "nothing on your list"}
          </span>
        </Link>
        <Link to="/emitters" className="your-work-item">
          <span className="readout-label">Assigned to me</span>
          <b className="readout-value">{work?.emitters.length ?? "–"}</b>
          <span className="hint-text">Emitters</span>
        </Link>
        <button
          type="button"
          className="your-work-item"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          disabled={editing.length === 0}
        >
          <span className="readout-label">You&apos;re editing</span>
          <b className="readout-value">{editing.length}</b>
          <span className="hint-text">
            {editing.length === 0
              ? "no Emitters"
              : `${editing.length === 1 ? "Emitter" : "Emitters"} · the oldest for ${heldFor(oldest, now)}`}
            {editing.length > 0 && <span className="your-work-toggle">{open ? " ▴" : " ▾"}</span>}
          </span>
        </button>
        {longHeld > 0 && (
          <p className="hint-text your-work-note">
            {longHeld} held over 8 hours — save or discard the ones you&apos;re done with, so others can edit.
          </p>
        )}
      </div>
      {open && editing.length > 0 && (
        <ul className="your-work-editing">
          {editing.map((c) => {
            const long = !!c.checked_out_at && now - Date.parse(c.checked_out_at) > LONG_HELD_MS;
            return (
              <li key={c.emitter_id}>
                <Link to={`/emitters/${c.emitter_id}`}>{c.emitter_name}</Link>
                <span className={long ? "checkout-held long" : "checkout-held"}>{heldFor(c.checked_out_at, now)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
