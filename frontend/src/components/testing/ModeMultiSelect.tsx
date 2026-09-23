import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";

export interface ModeNameOption {
  id: string;
  name: string;
}

const LIST_MAX_HEIGHT = 256;
const VIEWPORT_MARGIN = 8;

/**
 * Chips for the chosen Modes plus a search box in the same field. Typing
 * filters the Emitter's Modes; clicking a Mode (or Enter) toggles it and
 * keeps the list open, so many Modes can be picked in a row. The list is
 * portaled with fixed positioning so a table cell can't clip it.
 */
export function ModeMultiSelect({
  modes,
  selected,
  onChange,
  disabled,
}: {
  modes: ModeNameOption[];
  selected: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const fieldRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const nameOf = useMemo(() => new Map(modes.map((m) => [m.id, m.name])), [modes]);
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  // By name, numbers in natural order ("Track 2" before "Track 10").
  const sortedModes = useMemo(
    () => [...modes].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" })),
    [modes],
  );
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? sortedModes.filter((m) => m.name.toLowerCase().includes(q)) : sortedModes;
  }, [sortedModes, query]);
  const unselectedMatches = matches.filter((m) => !selectedSet.has(m.id));
  const showAddAll = query.trim() !== "" && unselectedMatches.length > 1;
  // Keyboard-navigable rows: the optional "add all" row, then each match.
  const rowCount = matches.length + (showAddAll ? 1 : 0);

  function toggle(id: string) {
    onChange(selectedSet.has(id) ? selected.filter((s) => s !== id) : [...selected, id]);
  }

  function addAllMatches() {
    onChange([...selected, ...unselectedMatches.map((m) => m.id)]);
    setQuery("");
  }

  function activate(index: number) {
    if (showAddAll && index === 0) addAllMatches();
    else {
      const m = matches[index - (showAddAll ? 1 : 0)];
      if (m) toggle(m.id);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((a) => Math.min(a + 1, rowCount - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      // Never submit the surrounding test-run form from here.
      e.preventDefault();
      if (open && rowCount > 0) activate(active);
    } else if (e.key === "Escape") {
      setOpen(false);
    } else if (e.key === "Backspace" && query === "" && selected.length > 0) {
      onChange(selected.slice(0, -1));
    }
  }

  // Start on the first Mode, not "Add all", so Enter never bulk-adds by surprise.
  useEffect(() => setActive(showAddAll ? 1 : 0), [query, showAddAll]);

  // Re-anchor under the field whenever it can have moved or grown (chips added).
  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    function place() {
      const rect = fieldRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.max(rect.width, 256);
      const left = Math.max(VIEWPORT_MARGIN, Math.min(rect.left, window.innerWidth - width - VIEWPORT_MARGIN));
      const listHeight = Math.min(listRef.current?.offsetHeight ?? LIST_MAX_HEIGHT, LIST_MAX_HEIGHT);
      const fitsBelow = rect.bottom + 4 + listHeight <= window.innerHeight - VIEWPORT_MARGIN;
      const top = fitsBelow ? rect.bottom + 4 : Math.max(VIEWPORT_MARGIN, rect.top - 4 - listHeight);
      setPos({ top, left, width });
    }
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, selected.length, query, rowCount]);

  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      const target = e.target as Node;
      if (!fieldRef.current?.contains(target) && !listRef.current?.contains(target)) setOpen(false);
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [open]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-row="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (disabled) {
    return (
      <div className="mode-multi-select mode-multi-select-disabled">
        {selected.map((id) => (
          <span key={id} className="mode-chip mode-chip-selected-static">
            {nameOf.get(id) ?? "(deleted Mode)"}
          </span>
        ))}
      </div>
    );
  }

  return (
    <div ref={fieldRef} className="mode-multi-select" onClick={() => inputRef.current?.focus()}>
      {selected.map((id) => (
        <span key={id} className="mode-chip mode-chip-selected-static">
          {nameOf.get(id) ?? "(deleted Mode)"}
          <button
            type="button"
            className="chip-remove"
            aria-label={`Remove ${nameOf.get(id) ?? "Mode"}`}
            onClick={(e) => {
              e.stopPropagation();
              onChange(selected.filter((s) => s !== id));
            }}
          >
            ×
          </button>
        </span>
      ))}
      {modes.length === 0 ? (
        <span className="hint-text">No Modes on this Emitter</span>
      ) : (
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          aria-label="Search intercepted Modes"
          className="mode-multi-select-input"
          placeholder={selected.length ? "+ add more…" : "Search Modes…"}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
        />
      )}
      {open &&
        modes.length > 0 &&
        createPortal(
          <ul
            ref={listRef}
            role="listbox"
            aria-multiselectable="true"
            className="mode-multi-select-list"
            style={pos ? { top: pos.top, left: pos.left, width: pos.width } : { visibility: "hidden" }}
            // Keep focus in the search box so the list stays open between picks.
            onMouseDown={(e) => e.preventDefault()}
          >
            {showAddAll && (
              <li
                data-row={0}
                role="option"
                aria-selected={false}
                className={active === 0 ? "mode-multi-select-option active add-all" : "mode-multi-select-option add-all"}
                onMouseEnter={() => setActive(0)}
                onClick={addAllMatches}
              >
                + Add all {unselectedMatches.length} matches
              </li>
            )}
            {matches.map((m, i) => {
              const row = i + (showAddAll ? 1 : 0);
              const isSelected = selectedSet.has(m.id);
              return (
                <li
                  key={m.id}
                  data-row={row}
                  role="option"
                  aria-selected={isSelected}
                  className={`mode-multi-select-option${active === row ? " active" : ""}${isSelected ? " selected" : ""}`}
                  onMouseEnter={() => setActive(row)}
                  onClick={() => toggle(m.id)}
                >
                  <span className="mode-multi-select-check">{isSelected ? "✓" : ""}</span>
                  {m.name}
                </li>
              );
            })}
            {matches.length === 0 && <li className="mode-multi-select-empty">No Modes match &ldquo;{query}&rdquo;</li>}
          </ul>,
          document.body,
        )}
    </div>
  );
}
