import { Link } from "react-router-dom";
import type { EntryMatch } from "./interceptMatch";
import { describeMiss } from "./interceptMatch";
import { modeLink } from "./interceptFormat";

const MAX_LISTED = 3;

/** The Modes an entry falls in, the ones it nearly does (and why), or that
 * there's none — the cue to create one. */
export function EntryMatchCell({ match, emitterId }: { match: EntryMatch; emitterId: string }) {
  if (match.status === "match") {
    return (
      <div className="entry-match">
        <span className="match-badge match-yes">Matches</span>{" "}
        {match.matches.slice(0, MAX_LISTED).map((m, i) => (
          <span key={m.id}>
            {i > 0 && ", "}
            <Link to={modeLink(emitterId, m)}>{m.name}</Link>
          </span>
        ))}
        {match.matches.length > MAX_LISTED && (
          <span className="hint-text"> +{match.matches.length - MAX_LISTED} more</span>
        )}
        {match.matches.length > 1 && (
          <div className="hint-text">Falls in {match.matches.length} Modes — they overlap here.</div>
        )}
      </div>
    );
  }
  if (match.status === "near") {
    return (
      <div className="entry-match">
        <span className="match-badge match-near">Near miss</span>
        <ul className="entry-match-near">
          {match.near.slice(0, MAX_LISTED).map(({ mode, misses }) => (
            <li key={mode.id}>
              <Link to={modeLink(emitterId, mode)}>{mode.name}</Link>{" "}
              <span className="hint-text">— {misses.map(describeMiss).join("; ")}</span>
            </li>
          ))}
        </ul>
        {match.near.length > MAX_LISTED && <span className="hint-text">+{match.near.length - MAX_LISTED} more</span>}
      </div>
    );
  }
  return (
    <div className="entry-match">
      <span className="match-badge match-none">No matching Mode</span>
    </div>
  );
}

/** "2 match · 1 near · 1 no match", skipping zeros. */
export function MatchCounts({ counts }: { counts: { match: number; near: number; none: number } }) {
  const parts: [number, string, string][] = [
    [counts.match, "match", "match-yes"],
    [counts.near, "near miss", "match-near"],
    [counts.none, "no match", "match-none"],
  ];
  const shown = parts.filter(([n]) => n > 0);
  if (shown.length === 0) return <span className="hint-text">—</span>;
  return (
    <span className="match-counts">
      {shown.map(([n, label, cls]) => (
        <span key={label} className={`match-badge ${cls}`}>
          {n} {label}
        </span>
      ))}
    </span>
  );
}
