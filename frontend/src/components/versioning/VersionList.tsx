import type { VersionSummary } from "../../types/versioning";
import { formatDateTime } from "../common/dates";
import { useSessionState } from "../common/useSessionState";

/** "25 Sep 2026, 08:24" — a version's date as people read it. */
export function versionDate(iso: string) {
  return formatDateTime(iso);
}

/** A version saved only for a status change — as every status change was,
 * before status stopped being saved as a version. */
export function isStatusOnly(v: VersionSummary): boolean {
  return (v.change_summary ?? "").startsWith("Status: ");
}

/** The versions, newest first: each row (all of it clickable) shows its
 * number, its summary, and who saved it when. Versions that only changed
 * the status are folded away (one line says how many), unless shown. */
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
  const [showStatusOnly, setShowStatusOnly] = useSessionState("versions.showStatusOnly", false);
  if (versions.length === 0) return <p className="hint-text">No saved versions yet.</p>;
  const latest = Math.max(...versions.map((v) => v.version_number));
  const statusOnly = versions.filter(isStatusOnly).length;
  const shown = [...versions]
    .reverse()
    .filter((v) => showStatusOnly || !isStatusOnly(v) || v.version_number === selected || v.version_number === latest);

  return (
    <>
    {statusOnly > 0 && (
      <p className="hint-text version-list-fold">
        {showStatusOnly
          ? `Showing ${statusOnly} version${statusOnly === 1 ? "" : "s"} saved only for a status change.`
          : `${statusOnly} version${statusOnly === 1 ? "" : "s"} saved only for a status change ${statusOnly === 1 ? "is" : "are"} folded away.`}{" "}
        <button type="button" className="link-button" onClick={() => setShowStatusOnly(!showStatusOnly)}>
          {showStatusOnly ? "Fold them" : "Show them"}
        </button>
      </p>
    )}
    <ul className="version-list">
      {shown.map((v) => (
        <li key={v.id}>
          <button
            type="button"
            className={[
              "version-row",
              v.version_number === selected ? "active" : "",
              isStatusOnly(v) ? "status-only" : "",
            ]
              .filter(Boolean)
              .join(" ")}
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
    </>
  );
}
