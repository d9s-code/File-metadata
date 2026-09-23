import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from "react";
import { createPortal } from "react-dom";

export interface ToggleableColumn<Id extends string> {
  id: Id;
  label: string;
  /** False for a column that must always show (e.g. Name). */
  hideable?: boolean;
}

const VIEWPORT_MARGIN = 8;

function readHidden(storageKey: string): string[] {
  try {
    const raw = localStorage.getItem(storageKey);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

/** Which columns of a table are shown. Stores the *hidden* ones, so a column
 * added later shows up by default. Remembered per browser. */
export function useColumnVisibility<Id extends string>(storageKey: string, columns: ToggleableColumn<Id>[]) {
  const [hidden, setHidden] = useState<Set<string>>(() => new Set(readHidden(storageKey)));

  function save(next: Set<string>) {
    setHidden(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify([...next]));
    } catch {
      // Storage unavailable (private window etc.) — the choice just won't persist.
    }
  }

  const isVisible = (id: Id) => !hidden.has(id);
  return {
    columns,
    isVisible,
    visibleCount: columns.filter((c) => isVisible(c.id)).length,
    toggle(id: Id) {
      const next = new Set(hidden);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      save(next);
    },
    showAll() {
      save(new Set());
    },
  };
}

export type ColumnVisibility<Id extends string> = ReturnType<typeof useColumnVisibility<Id>>;

/** Right-click menu for a table header: tick or untick which columns show.
 * Spread `openProps` onto the header row. */
export function useColumnVisibilityMenu<Id extends string>(visibility: ColumnVisibility<Id>) {
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);

  const openProps = {
    onContextMenu(e: MouseEvent) {
      e.preventDefault();
      setAnchor({ x: e.clientX, y: e.clientY });
    },
    title: "Right-click to choose which columns to show",
  };

  const menu = anchor ? (
    <ColumnMenu visibility={visibility} anchor={anchor} onClose={() => setAnchor(null)} />
  ) : null;

  return { openProps, menu };
}

function ColumnMenu<Id extends string>({
  visibility,
  anchor,
  onClose,
}: {
  visibility: ColumnVisibility<Id>;
  anchor: { x: number; y: number };
  onClose: () => void;
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
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", onClose, true);
    window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", onClose, true);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  const allShown = visibility.visibleCount === visibility.columns.length;

  return createPortal(
    <div
      ref={ref}
      role="menu"
      aria-label="Choose columns"
      className="column-menu"
      style={pos ?? { top: anchor.y, left: anchor.x, visibility: "hidden" }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="column-menu-title">Columns</div>
      {visibility.columns.map((c) => {
        const locked = c.hideable === false;
        return (
          <label key={c.id} className={locked ? "column-menu-item locked" : "column-menu-item"}>
            <input
              type="checkbox"
              role="menuitemcheckbox"
              checked={visibility.isVisible(c.id)}
              disabled={locked}
              onChange={() => visibility.toggle(c.id)}
            />
            {c.label}
          </label>
        );
      })}
      <button type="button" className="link-button column-menu-reset" disabled={allShown} onClick={visibility.showAll}>
        Show all columns
      </button>
    </div>,
    document.body,
  );
}
