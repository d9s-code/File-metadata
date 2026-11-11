import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

const VIEWPORT_MARGIN = 8;

export interface CheckMenuItem {
  id: string;
  label: ReactNode;
  checked: boolean;
  disabled?: boolean;
  /** Shown faint at the end of the row, e.g. how many rows it covers. */
  hint?: ReactNode;
}

/** A small popup of checkboxes opened at a point (a right-click, or under a
 * button): ticking one keeps it open, a click outside, Escape or a scroll
 * closes it. The table column chooser and the Emitters list's status filter
 * use it. */
export function CheckMenu({
  title,
  ariaLabel,
  anchor,
  items,
  onToggle,
  onClose,
  footer,
}: {
  title: ReactNode;
  ariaLabel: string;
  anchor: { x: number; y: number };
  items: CheckMenuItem[];
  onToggle: (id: string) => void;
  onClose: () => void;
  footer?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  // Open at the pointer, nudged back inside the viewport if it would overflow.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    setPos({
      left: Math.max(VIEWPORT_MARGIN, Math.min(anchor.x, window.innerWidth - width - VIEWPORT_MARGIN)),
      top: Math.max(VIEWPORT_MARGIN, Math.min(anchor.y, window.innerHeight - height - VIEWPORT_MARGIN)),
    });
  }, [anchor]);

  useEffect(() => {
    function onMouseDown(e: globalThis.MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) onClose();
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    function onScroll(e: Event) {
      // Scrolling the menu's own list keeps it open.
      if (!ref.current?.contains(e.target as Node)) onClose();
    }
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={ref}
      role="menu"
      aria-label={ariaLabel}
      className="column-menu"
      style={pos ?? { top: anchor.y, left: anchor.x, visibility: "hidden" }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="column-menu-title">{title}</div>
      {items.map((item) => (
        <label key={item.id} className={item.disabled ? "column-menu-item locked" : "column-menu-item"}>
          <input
            type="checkbox"
            role="menuitemcheckbox"
            checked={item.checked}
            disabled={item.disabled}
            onChange={() => onToggle(item.id)}
          />
          {item.label}
          {item.hint != null && <span className="column-menu-hint">{item.hint}</span>}
        </label>
      ))}
      {footer}
    </div>,
    document.body,
  );
}
