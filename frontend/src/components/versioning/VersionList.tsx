import type { VersionSummary } from "../../types/versioning";

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
   * shown with a badge since they can be viewed/diffed but not reverted to. */
  forkBoundary?: number | null;
}) {
  if (versions.length === 0) return <p className="hint-text">No committed versions yet.</p>;

  return (
    <ul className="version-list">
      {[...versions].reverse().map((v) => (
        <li key={v.id} className={v.version_number === selected ? "version-item active" : "version-item"}>
          <button className="link-button version-select" onClick={() => onSelect(v.version_number)}>
            v{v.version_number}
          </button>
          <span className="version-summary">{v.change_summary ?? "—"}</span>
          {forkBoundary != null && v.version_number <= forkBoundary && (
            <span className="version-badge" title="Copied in from the source Emitter at fork time — view/diff only">
              pre-fork
            </span>
          )}
          <span className="version-meta">{new Date(v.created_at).toLocaleString()}</span>
        </li>
      ))}
    </ul>
  );
}
