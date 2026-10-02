import { Link } from "react-router-dom";
import type { EntryMatch } from "./interceptMatch";
import { describeMiss } from "./interceptMatch";
import { modeLink } from "./interceptFormat";

const MAX_LISTED = 3;

/** One line: the badge and the first Mode, with the rest (and why a near
 * miss misses) in the tooltip — for tables of hundreds of rows. */
function CompactMatch({ match, emitterId }: { match: EntryMatch; emitterId: string }) {
  if (match.status === "none") {
    return <span className="match-badge match-none">No matching Mode</span>;
  }
  const near = match.status === "near";
  const modes = near ? match.near.map((n) => n.mode) : match.matches;
  const first = modes[0];
  const title = near
    ? match.near.map(({ mode, misses }) => `${mode.name}: ${misses.map(describeMiss).join("; ")}`).join("\n")
    : `Falls in ${modes.map((m) => m.name).join(", ")}`;
  return (
    <span className="entry-match-compact" title={title}>
      <span className={near ? "match-badge match-near" : "match-badge match-yes"}>{near ? "Near miss" : "Matches"}</span>{" "}
      <Link to={modeLink(emitterId, first)}>{first.name}</Link>
      {modes.length > 1 && <span className="hint-text"> +{modes.length - 1}</span>}
      {near && match.near[0].misses[0] && (
        <span className="hint-text"> · {match.near[0].misses[0].label} off</span>
      )}
    </span>
  );
}

/** The Modes an entry falls in, the ones it nearly does (and why), or that
 * there's none — the cue to create one. `compact` keeps it to one line. */
export function EntryMatchCell({
  match,
  emitterId,
  compact = false,
}: {
  match: EntryMatch;
  emitterId: string;
  compact?: boolean;
}) {
  if (compact) return <CompactMatch match={match} emitterId={emitterId} />;
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
