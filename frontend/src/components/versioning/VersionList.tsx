import type { VersionSummary } from "../../types/versioning";

export function VersionList({
  versions,
  selected,
  onSelect,
}: {
  versions: VersionSummary[];
  selected: number | null;
  onSelect: (versionNumber: number) => void;
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
          <span className="version-meta">{new Date(v.created_at).toLocaleString()}</span>
        </li>
      ))}
    </ul>
  );
}
