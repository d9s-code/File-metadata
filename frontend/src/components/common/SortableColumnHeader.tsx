import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useFloatingPosition } from "./useFloatingPosition";
import type { SortDirection } from "./sortUtils";

const ASCENDING_LABEL: Record<ColumnType, string> = {
  string: "Sort A → Z",
  number: "Sort smallest → largest",
  date: "Sort oldest → newest",
};
const DESCENDING_LABEL: Record<ColumnType, string> = {
  string: "Sort Z → A",
  number: "Sort largest → smallest",
  date: "Sort newest → oldest",
};

export type ColumnType = "string" | "number" | "date";

/**
 * A clickable table header cell that opens a small dropdown with direction
 * options (labeled to match the column's data — A→Z for text, smallest→largest
 * for numbers, oldest→newest for dates) plus a "Clear sort" option when this
 * column is the active one — the one reusable sort control every data table in
 * the app uses. Structured as a list of buttons (like the Audit Log's entity
 * picker) so a filter-checkbox section can be appended below later without
 * restructuring.
 */
export function SortableColumnHeader<K extends string>({
  label,
  columnKey,
  columnType = "string",
  activeKey,
  activeDir,
  onSort,
  onClear,
}: {
  label: ReactNode;
  columnKey: K;
  /** Governs the direction-option wording — "smallest/largest" for numbers,
   * "oldest/newest" for dates, "A→Z" for everything else. Defaults to string. */
  columnType?: ColumnType;
  activeKey: K | null;
  activeDir: SortDirection | null;
  onSort: (key: K, dir: SortDirection) => void;
  /** Resets this table back to its unsorted default order. Omit to hide the
   * "Clear sort" option entirely (rare — only when there's truly no sensible
   * default order to return to). */
  onClear?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const pos = useFloatingPosition(triggerRef, contentRef, open);
  const active = activeKey === columnKey;

  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      if (!contentRef.current?.contains(e.target as Node) && !triggerRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
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

  function pick(dir: SortDirection) {
    onSort(columnKey, dir);
    setOpen(false);
  }

  function clear() {
    onClear?.();
    setOpen(false);
  }

  return (
    <th>
      <button
        ref={triggerRef}
        type="button"
        className="sortable-th-trigger"
        onClick={() => setOpen((v) => !v)}
      >
        {label}
        {active && <span className="sort-indicator">{activeDir === "asc" ? "▲" : "▼"}</span>}
        <span className="sortable-th-caret">▾</span>
      </button>
      {open &&
        pos &&
        createPortal(
          <div ref={contentRef} className="sortable-th-menu" role="menu" style={{ top: pos.top, left: pos.left }}>
            <button type="button" className={active && activeDir === "asc" ? "active" : undefined} onClick={() => pick("asc")}>
              {ASCENDING_LABEL[columnType]}
            </button>
            <button type="button" className={active && activeDir === "desc" ? "active" : undefined} onClick={() => pick("desc")}>
              {DESCENDING_LABEL[columnType]}
            </button>
            {active && onClear && (
              <>
                <div className="sortable-th-menu-divider" />
                <button type="button" onClick={clear}>
                  Clear sort
                </button>
              </>
            )}
          </div>,
          document.body,
        )}
    </th>
  );
}
