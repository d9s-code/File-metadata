import { useCallback, useState, type MouseEvent } from "react";
import { CheckMenu } from "./CheckMenu";

export interface ToggleableColumn<Id extends string> {
  id: Id;
  label: string;
  /** False for a column that must always show (e.g. Name). */
  hideable?: boolean;
  /** Starts hidden until someone ticks it. */
  defaultHidden?: boolean;
}

/** Stored choices: column id -> shown. Older versions stored an array of
 * hidden ids, which still reads correctly. */
function readChoices(storageKey: string): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(storageKey);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (Array.isArray(parsed)) {
      return Object.fromEntries(parsed.filter((v): v is string => typeof v === "string").map((id) => [id, false]));
    }
    if (parsed && typeof parsed === "object") {
      return Object.fromEntries(Object.entries(parsed).filter(([, v]) => typeof v === "boolean")) as Record<string, boolean>;
    }
  } catch {
    // Unreadable or unavailable storage — fall back to the defaults.
  }
  return {};
}

/** Which columns of a table are shown. Only choices the user made are
 * stored, so a column added later gets its own default. Remembered per
 * browser. */
export function useColumnVisibility<Id extends string>(storageKey: string, columns: ToggleableColumn<Id>[]) {
  const [choices, setChoices] = useState<Record<string, boolean>>(() => readChoices(storageKey));

  function save(next: Record<string, boolean>) {
    setChoices(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      // Storage unavailable (private window etc.) — the choice just won't persist.
    }
  }

  const isVisible = (id: Id) => {
    const column = columns.find((c) => c.id === id);
    if (column?.hideable === false) return true;
    return choices[id] ?? !column?.defaultHidden;
  };
  return {
    columns,
    isVisible,
    visibleCount: columns.filter((c) => isVisible(c.id)).length,
    toggle(id: Id) {
      save({ ...choices, [id]: !isVisible(id) });
    },
    showAll() {
      save(Object.fromEntries(columns.map((c) => [c.id, true])));
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

  const close = useCallback(() => setAnchor(null), []);
  const menu = anchor ? (
    <ColumnMenu visibility={visibility} anchor={anchor} onClose={close} />
  ) : null;

  /** Open it under a "Columns" button. */
  function openFrom(e: MouseEvent<HTMLElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    setAnchor({ x: r.left, y: r.bottom + 4 });
  }

  return { openProps, menu, openFrom };
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
  const allShown = visibility.visibleCount === visibility.columns.length;
  return (
    <CheckMenu
      title="Columns"
      ariaLabel="Choose columns"
      anchor={anchor}
      onClose={onClose}
      items={visibility.columns.map((c) => ({
        id: c.id,
        label: c.label,
        checked: visibility.isVisible(c.id),
        disabled: c.hideable === false,
      }))}
      onToggle={(id) => visibility.toggle(id as Id)}
      footer={
        <button type="button" className="link-button column-menu-reset" disabled={allShown} onClick={visibility.showAll}>
          Show all columns
        </button>
      }
    />
  );
}
