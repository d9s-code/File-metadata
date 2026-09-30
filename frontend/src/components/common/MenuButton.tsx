import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";

export interface MenuItem {
  label: ReactNode;
  /** A route to go to, or… */
  to?: string;
  /** …an action to run. */
  onSelect?: () => void;
  disabled?: boolean;
  title?: string;
}

/** A button that opens a short list of secondary actions — keeps the ones
 * people rarely need out of the main toolbar. */
export function MenuButton({ label, items, align = "right" }: { label: ReactNode; items: MenuItem[]; align?: "left" | "right" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="menu-button" ref={ref}>
      <button type="button" className="button secondary" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {label}
      </button>
      {open && (
        <div role="menu" className={`menu-button-list menu-align-${align}`}>
          {items.map((item, i) =>
            item.to && !item.disabled ? (
              <Link key={i} role="menuitem" className="menu-button-item" to={item.to} title={item.title} onClick={() => setOpen(false)}>
                {item.label}
              </Link>
            ) : (
              <button
                key={i}
                type="button"
                role="menuitem"
                className="menu-button-item"
                disabled={item.disabled}
                title={item.title}
                onClick={() => {
                  setOpen(false);
                  item.onSelect?.();
                }}
              >
                {item.label}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}
