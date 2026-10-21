import type { ReactNode } from "react";

/** A list's filters on one line above its table. "Reset" only shows while a
 * filter is set; the count of what's shown sits at the end. */
export function FilterBar({
  children,
  active,
  onReset,
  count,
  end,
}: {
  children: ReactNode;
  /** Whether any filter is set. */
  active: boolean;
  onReset: () => void;
  /** E.g. "12 of 27". */
  count?: ReactNode;
  /** Extra controls at the right (e.g. a Columns button). */
  end?: ReactNode;
}) {
  return (
    <div className="filter-bar">
      {children}
      {active && (
        <button type="button" className="link-button" onClick={onReset}>
          Reset
        </button>
      )}
      <span className="filter-bar-end">
        {count != null && <span className="hint-text">{count}</span>}
        {end}
      </span>
    </div>
  );
}

/** "12 of 27 Emitters", or "27 Emitters" when nothing is filtered out. */
export function shownCount(shown: number, total: number, noun: string, plural = `${noun}s`) {
  const word = total === 1 ? noun : plural;
  return shown === total ? `${total} ${word}` : `${shown} of ${total} ${word}`;
}
