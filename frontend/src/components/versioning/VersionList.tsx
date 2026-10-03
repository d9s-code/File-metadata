import type { VersionSummary } from "../../types/versioning";

/** "25 Sep 2026, 08:24" — a version's date as people read it. */
export function versionDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/** The versions, newest first: each row (all of it clickable) shows its
 * number, its summary, and who saved it when. */
export function VersionList({
  versions,
  selected,
  onSelect,
  forkBoundary = null,
}: {
  versions: VersionSummary[];
  selected: number | null;
  onSelect: (versionNumber: number) => void;
  /** version_number at or below which entries were copied in from the
   * source Emitter at fork time (see Emitter.forked_at_version_number) —
   * shown with a tag since they can be viewed/diffed but not reverted to. */
  forkBoundary?: number | null;
}) {
  if (versions.length === 0) return <p className="hint-text">No saved versions yet.</p>;
  const latest = Math.max(...versions.map((v) => v.version_number));

  return (
    <ul className="version-list">
      {[...versions].reverse().map((v) => (
        <li key={v.id}>
          <button
            type="button"
            className={v.version_number === selected ? "version-row active" : "version-row"}
            aria-current={v.version_number === selected ? "true" : undefined}
            onClick={() => onSelect(v.version_number)}
          >
            <span className="version-row-top">
              <span className="version-number">v{v.version_number}</span>
              {v.version_number === latest && <span className="version-tag latest">Latest</span>}
              {forkBoundary != null && v.version_number <= forkBoundary && (
                <span className="version-tag" title="Copied in from the source Emitter at fork time — view and compare only">
                  Before fork
                </span>
              )}
            </span>
            <span className={v.change_summary ? "version-row-summary" : "version-row-summary none"}>
              {v.change_summary || "No summary"}
            </span>
            <span className="version-row-meta">
              {v.created_by_username ? `${v.created_by_username} · ` : ""}
              {versionDate(v.created_at)}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
