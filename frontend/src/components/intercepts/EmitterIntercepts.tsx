import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useEmitterInterceptEntries, useIntercepts } from "../../state/hooks/useIntercepts";
import { useEmitterModes } from "../../state/hooks/useModes";
import { RequireRole } from "../../auth/RequireAuth";
import { LoadingState } from "../common/LoadingState";
import { EmptyState } from "../common/EmptyState";
import { InterceptFormModal } from "./InterceptFormModal";
import { MatchCounts } from "./EntryMatchCell";
import { countMatches } from "./interceptMatch";
import { formatDay } from "./interceptFormat";
import type { InterceptEntry } from "../../types/domain";

export function EmitterIntercepts({ emitterId }: { emitterId: string }) {
  const { data: intercepts, isLoading } = useIntercepts({ emitterId });
  const { data: entries } = useEmitterInterceptEntries(emitterId);
  const { data: modes } = useEmitterModes(emitterId);
  const [showAdd, setShowAdd] = useState(false);
  const navigate = useNavigate();

  const entriesByIntercept = new Map<string, InterceptEntry[]>();
  for (const e of entries ?? []) {
    const list = entriesByIntercept.get(e.intercept_id) ?? [];
    list.push(e);
    entriesByIntercept.set(e.intercept_id, list);
  }
  const ready = entries != null && modes != null;
  const total = ready ? countMatches(entries, modes) : null;
  const unmatched = total ? total.none + total.near : 0;

  return (
    <section className="card">
      <div className="card-header">
        <h4>
          Intercepts <span className="section-count">{intercepts?.length ?? 0}</span>
        </h4>
        <RequireRole minimum="editor">
          <span className="section-actions">
            <Link className="button secondary small" to={`/intercepts/import?emitter=${emitterId}`}>
              Import CSV
            </Link>
            <button type="button" className="button secondary small" onClick={() => setShowAdd(true)}>
              + Add Intercept
            </button>
          </span>
        </RequireRole>
      </div>
      <p className="hint-text">
        Real-world recordings of this Emitter. Each entry is checked against the Modes&apos; engineered RF, PRI and PW
        ranges.
        {total && unmatched > 0 && (
          <>
            {" "}
            <strong className="summary-bad">
              {unmatched} {unmatched === 1 ? "entry doesn't" : "entries don't"} match a Mode
            </strong>
            {total.near > 0 && ` (${total.near} near miss${total.near === 1 ? "" : "es"})`}.
          </>
        )}
        {total && unmatched === 0 && (entries?.length ?? 0) > 0 && (
          <>
            {" "}
            <span className="summary-good">Every entry matches a Mode.</span>
          </>
        )}
      </p>

      {isLoading ? (
        <LoadingState label="Loading intercepts…" />
      ) : !intercepts || intercepts.length === 0 ? (
        <EmptyState compact title="No Intercepts yet" message="Add one to log a real-world recording of this Emitter." />
      ) : (
        <div className="matrix-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Recorded</th>
                <th>Collected by</th>
                <th>Entries</th>
                <th>Match against Modes</th>
              </tr>
            </thead>
            <tbody>
              {intercepts.map((i) => {
                const own = entriesByIntercept.get(i.id) ?? [];
                return (
                  <tr key={i.id}>
                    <td>
                      <Link to={`/intercepts/${i.id}`}>{i.name}</Link>
                      {i.description && <div className="hint-text cell-subline">{i.description}</div>}
                    </td>
                    <td title={`Logged ${new Date(i.created_at).toLocaleString()}`}>
                      {formatDay(i.intercepted_on) ?? <span className="hint-text">—</span>}
                    </td>
                    <td>{i.collected_by ?? <span className="hint-text">—</span>}</td>
                    <td>{i.entry_count}</td>
                    <td>{ready ? <MatchCounts counts={countMatches(own, modes)} /> : <span className="hint-text">…</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {showAdd && (
        <InterceptFormModal
          emitterId={emitterId}
          onClose={() => setShowAdd(false)}
          onSaved={(saved) => navigate(`/intercepts/${saved.id}`)}
        />
      )}
    </section>
  );
}
