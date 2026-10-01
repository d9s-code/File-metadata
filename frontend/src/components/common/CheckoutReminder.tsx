import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { heldFor, LONG_HELD_MS, useCheckouts } from "../../state/hooks/useEmitterCheckout";

const COLLAPSED_KEY = "checkout-reminder-collapsed";
/** Listed before "Show all" — the longest-held, so the ones that matter most. */
const SHOWN = 4;

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === "true";
  } catch {
    return false;
  }
}

/** A small panel in the bottom-left corner, on every page, listing the
 * Emitters you're holding for editing — nobody else can edit them until you
 * save a version or discard. Folds down to a tab; the choice is remembered. */
export function CheckoutReminder() {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const { data: checkouts } = useCheckouts(!!user);
  const [collapsed, setCollapsedState] = useState(readCollapsed);
  const [showAll, setShowAll] = useState(false);

  function setCollapsed(value: boolean) {
    setCollapsedState(value);
    try {
      localStorage.setItem(COLLAPSED_KEY, String(value));
    } catch {
      // Storage unavailable — it just won't be remembered.
    }
  }

  if (!user || pathname === "/login") return null;
  const mine = (checkouts ?? []).filter((c) => c.checked_out_by_id === user.id);
  if (mine.length === 0) return null;

  const now = Date.now();
  const longHeld = mine.filter((c) => c.checked_out_at && now - Date.parse(c.checked_out_at) > LONG_HELD_MS).length;
  const label = `Editing ${mine.length} Emitter${mine.length === 1 ? "" : "s"}`;

  if (collapsed) {
    return (
      <button
        type="button"
        className={longHeld ? "checkout-reminder-tab long-held" : "checkout-reminder-tab"}
        onClick={() => setCollapsed(false)}
        title="Show the Emitters you're editing"
      >
        ✎ {label}
        {longHeld > 0 && " · held long"}
      </button>
    );
  }

  return (
    <aside className={longHeld ? "checkout-reminder long-held" : "checkout-reminder"} aria-label="Emitters you're editing">
      <div className="checkout-reminder-header">
        <strong>✎ {label}</strong>
        <button type="button" className="link-button" onClick={() => setCollapsed(true)} aria-label="Fold away">
          –
        </button>
      </div>
      <p className="hint-text">Others can&apos;t edit these until you save a version or discard.</p>
      <ul>
        {(showAll ? mine : mine.slice(0, SHOWN)).map((c) => {
          const long = !!c.checked_out_at && now - Date.parse(c.checked_out_at) > LONG_HELD_MS;
          return (
            <li key={c.emitter_id}>
              <Link to={`/emitters/${c.emitter_id}`}>{c.emitter_name}</Link>
              <span className={long ? "checkout-held long" : "checkout-held"}>{heldFor(c.checked_out_at, now)}</span>
            </li>
          );
        })}
      </ul>
      {mine.length > SHOWN && (
        <button type="button" className="link-button" onClick={() => setShowAll((v) => !v)}>
          {showAll ? "Show fewer" : `Show all ${mine.length}`}
        </button>
      )}
      {longHeld > 0 && (
        <p className="checkout-reminder-warning">
          Held over 8 hours — save or discard if you&apos;re done, so others can edit.
        </p>
      )}
    </aside>
  );
}
