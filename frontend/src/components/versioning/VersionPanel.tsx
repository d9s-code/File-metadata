import type { ReactNode } from "react";
import type { EmitterDiffResult, VersionSummary } from "../../types/versioning";
import { EmitterDiffViewer, changeCounts } from "./EmitterDiffViewer";
import { versionDate } from "./VersionList";

/** The selected version of an Emitter, Platform or MDF: its number, summary,
 * who saved it and when, its actions (revert, fork, export…) beside it, and
 * what changed — since the version before, or any other one picked. */
export function VersionPanel({
  versions,
  selected,
  against,
  onAgainst,
  diff,
  loading,
  actions,
  tags,
  notice,
}: {
  versions: VersionSummary[];
  selected: number;
  /** The version compared with; null = the one just before. */
  against: number | null;
  onAgainst: (versionNumber: number | null) => void;
  diff: EmitterDiffResult | undefined;
  loading: boolean;
  actions?: ReactNode;
  /** Extra tags beside the title (e.g. "Before fork"). */
  tags?: ReactNode;
  /** A note above the changes (e.g. where a fork happened). */
  notice?: ReactNode;
}) {
  const version = versions.find((v) => v.version_number === selected);
  const latest = versions.length ? Math.max(...versions.map((v) => v.version_number)) : null;
  const baseline = against ?? (selected > 1 ? selected - 1 : null);
  const others = [...versions].reverse().filter((v) => v.version_number !== selected);

  return (
    <div className="card version-panel">
      <div className="version-panel-head">
        <div>
          <h2 className="version-panel-title">
            Version {selected}
            {selected === latest && <span className="version-tag latest">Latest</span>}
            {tags}
          </h2>
          <p className={version?.change_summary ? "version-panel-summary" : "version-panel-summary none"}>
            {version?.change_summary || "No summary"}
          </p>
          {version && (
            <p className="hint-text version-panel-meta">
              Saved {version.created_by_username ? `by ${version.created_by_username} ` : ""}on {versionDate(version.created_at)}
            </p>
          )}
        </div>
        {actions && <div className="version-panel-actions">{actions}</div>}
      </div>

      <div className="version-compare">
        {baseline == null ? (
          <span className="hint-text">The first version — there&apos;s nothing before it to compare with.</span>
        ) : (
          <>
            <label className="inline-label">
              Changes since
              <select value={against ?? ""} onChange={(e) => onAgainst(e.target.value === "" ? null : Number(e.target.value))}>
                {selected > 1 && <option value="">v{selected - 1} (the one before)</option>}
                {others
                  .filter((v) => v.version_number !== selected - 1)
                  .map((v) => (
                    <option key={v.id} value={v.version_number}>
                      v{v.version_number}
                      {v.version_number === latest ? " (latest)" : ""}
                      {v.version_number > selected ? " — newer" : ""}
                    </option>
                  ))}
              </select>
            </label>
            {diff && !diff.identical && <span className="hint-text">{changeCounts(diff.entries)}</span>}
          </>
        )}
      </div>
      {notice}
      {baseline != null && loading && <p className="hint-text">Loading changes…</p>}
      {baseline != null && diff && <EmitterDiffViewer diff={diff} />}
    </div>
  );
}
