import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";

export interface MenuItem {
  label: ReactNode;
  /** A route to go to, or… */
  to?: string;
  /** …an action to run. */
  onSelect?: () => void;
  disabled?: boolean;
  title?: string;
  danger?: boolean;
}

const VIEWPORT_MARGIN = 8;

/** A button that opens a short list of secondary actions — keeps the ones
 * people rarely need out of the main toolbar. The list is portaled with
 * fixed positioning, so a scrolling table can't clip it. */
export function MenuButton({
  label,
  items,
  className = "button secondary",
  ariaLabel,
}: {
  label: ReactNode;
  items: MenuItem[];
  className?: string;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Right-aligned under the button, flipped above when there's no room, and
  // kept there while the page or a scrolling table moves.
  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    function place() {
      const button = buttonRef.current?.getBoundingClientRect();
      const list = listRef.current?.getBoundingClientRect();
      if (!button || !list) return;
      if (button.bottom < 0 || button.top > window.innerHeight) {
        setOpen(false);
        return;
      }
      const left = Math.max(VIEWPORT_MARGIN, Math.min(button.right - list.width, window.innerWidth - list.width - VIEWPORT_MARGIN));
      const below = button.bottom + 4;
      const top =
        below + list.height > window.innerHeight - VIEWPORT_MARGIN ? Math.max(VIEWPORT_MARGIN, button.top - 4 - list.height) : below;
      setPos({ top, left });
    }
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      const target = e.target as Node;
      if (!buttonRef.current?.contains(target) && !listRef.current?.contains(target)) setOpen(false);
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
    <>
      <button
        ref={buttonRef}
        type="button"
        className={className}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((v) => !v)}
      >
        {label}
      </button>
      {open &&
        createPortal(
          <div
            ref={listRef}
            role="menu"
            className="menu-button-list"
            style={pos ?? { top: 0, left: 0, visibility: "hidden" }}
          >
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
                  className={item.danger ? "menu-button-item danger" : "menu-button-item"}
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
          </div>,
          document.body,
        )}
    </>
  );
}
