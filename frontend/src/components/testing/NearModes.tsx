import { useState } from "react";
import { describeMiss, missCloseness, shortMiss, type ModeMatch } from "../intercepts/interceptMatch";

/** Modes listed before "+N more". */
const SHOWN = 2;

const closeness = (n: ModeMatch) => n.misses.reduce((sum, m) => sum + missCloseness(m), 0);

/** The Modes a logged set nearly matches, closest first, one short line
 * each ("Mode 12 · PW 0.15 µs above · Edit…", the full detail on hover);
 * the first two, then "+N more" — so a set near many Modes stays a few
 * lines high. */
export function NearModes({
  near,
  onEdit,
  editDisabled,
  editTitle,
}: {
  near: ModeMatch[];
  /** Given: each Mode gets "Edit…", opening it widened to take in the set. */
  onEdit?: (n: ModeMatch) => void;
  editDisabled?: boolean;
  editTitle?: string;
}) {
  const [all, setAll] = useState(false);
  const sorted = [...near].sort((a, b) => closeness(a) - closeness(b) || a.mode.name.localeCompare(b.mode.name));
  const shown = all ? sorted : sorted.slice(0, SHOWN);
  return (
    <ul className="near-modes">
      {shown.map((n) => (
        <li key={n.mode.id}>
          <span className="near-mode-name">{n.mode.name}</span>
          <span className="hint-text" title={n.misses.map(describeMiss).join("\n")}>
            {" · "}
            {n.misses.map(shortMiss).join("; ")}
          </span>
          {onEdit && (
            <>
              {" · "}
              <button
                type="button"
                className="link-button"
                disabled={editDisabled}
                title={editTitle}
                aria-label={`Edit ${n.mode.name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onEdit(n);
                }}
              >
                Edit…
              </button>
            </>
          )}
        </li>
      ))}
      {sorted.length > SHOWN && (
        <li>
          <button
            type="button"
            className="link-button"
            aria-expanded={all}
            onClick={(e) => {
              e.stopPropagation();
              setAll(!all);
            }}
          >
            {all ? "Show fewer" : `+${sorted.length - SHOWN} more`}
          </button>
        </li>
      )}
    </ul>
  );
}
