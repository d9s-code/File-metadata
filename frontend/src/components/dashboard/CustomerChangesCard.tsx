import { Link } from "react-router-dom";
import type { DashboardRelease } from "../../api/dashboard";
import { EmptyState } from "../common/EmptyState";
import { ChangeNotesList } from "../mdf/MdfSummary";

/** What the customer will get: the current MDF's change notes, counted as its
 * summary counts them by default (since its last release, else since the MDF
 * it follows, else everything). */
export function CustomerChangesCard({ release }: { release: DashboardRelease }) {
  const { mdf, changes } = release;
  const notes = changes?.change_notes;
  return (
    <div className="card customer-changes">
      <div className="dashboard-card-header">
        <h2 className="as-h4">What the customer will get</h2>
        {mdf && changes && (
          <span className="hint-text">
            v{changes.to_version} against {changes.since}
          </span>
        )}
      </div>
      {!mdf ? (
        <EmptyState icon="○" title="No current MDF" message="Its change notes show here." compact />
      ) : !notes ? (
        <EmptyState icon="○" title="Not saved yet" message="Save a version of the MDF to see what changed." compact />
      ) : (
        <>
          <div className="customer-changes-counts">
            <span>
              <b className="release-big">{notes.added.length}</b> added
            </span>
            <span>
              <b className="release-big">{notes.removed.length}</b> removed
            </span>
            <span>
              <b className="release-big">{notes.updated.length}</b> updated
            </span>
          </div>
          <div className="customer-changes-list">
            <ChangeNotesList notes={notes} />
          </div>
          <Link className="button secondary small customer-changes-link" to={`/mdfs/${mdf.id}?tab=plan`}>
            Summary &amp; release notes
          </Link>
        </>
      )}
    </div>
  );
}
