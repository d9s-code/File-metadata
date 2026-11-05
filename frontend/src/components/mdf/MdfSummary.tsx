import { useState } from "react";
import { ApiRequestError } from "../../api/client";
import { mdfPlanApi, type PinChange } from "../../api/mdfPlan";
import type { MdfVersionSummary } from "../../api/mdfVersions";
import { useMdfSummary } from "../../state/hooks/useMdfPlan";
import { formatDate, formatDateTime } from "../common/dates";

/** The pins that changed: added, removed or at another version. */
function Changes({ changes }: { changes: PinChange[] }) {
  if (changes.length === 0) return <p className="hint-text">No changes to the pins.</p>;
  return (
    <ul className="mdf-changes">
      {changes.map((c, i) => (
        <li key={i} className={`mdf-change ${c.kind}`}>
          <span className="mdf-change-mark" aria-hidden>
            {c.kind === "added" ? "+" : c.kind === "removed" ? "−" : "~"}
          </span>
          <span>
            <strong>{c.scope}</strong> {c.label.toLowerCase()}
            {c.old_value && c.new_value ? `: ${c.old_value} → ${c.new_value}` : c.new_value ? ` — ${c.new_value}` : c.old_value ? ` — ${c.old_value}` : ""}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** "Summarize…": what changed between two saved versions (by default since
 * the last release), with its release notes, goals, status moves and log —
 * on the page, or as a Word document (the release notes). */
export function SummaryPanel({ mdfId, versions, onClose }: { mdfId: string; versions: MdfVersionSummary[]; onClose: () => void }) {
  const [from, setFrom] = useState<number | null>(null);
  const [to, setTo] = useState<number | null>(null);
  const [picked, setPicked] = useState(false);
  const { data: s, isFetching, error } = useMdfSummary(mdfId, picked ? from : null, picked ? to : null, true);
  const fromShown = picked ? from : (s?.from_version ?? null);
  const toShown = picked ? to : (s?.to_version ?? null);
  const docUrl = mdfPlanApi.summaryDocxUrl(mdfId, s?.from_version ?? null, s?.to_version ?? null);
  return (
    <section className="card mdf-summary">
      <div className="card-header">
        <h2 className="as-h4">Summary</h2>
        <button type="button" className="link-button" onClick={onClose} aria-label="Close the summary">
          ✕
        </button>
      </div>
      <div className="inline-form mdf-summary-range">
        <label>
          From
          <select
            value={fromShown ?? ""}
            onChange={(e) => {
              setPicked(true);
              setFrom(e.target.value ? Number(e.target.value) : null);
              setTo(toShown);
            }}
          >
            <option value="">The start</option>
            {versions.map((v) => (
              <option key={v.id} value={v.version_number}>
                v{v.version_number} · {formatDate(v.created_at)}
                {s?.last_release_version === v.version_number ? " (last release)" : ""}
              </option>
            ))}
          </select>
        </label>
        <label>
          To
          <select
            value={toShown ?? ""}
            onChange={(e) => {
              setPicked(true);
              setTo(Number(e.target.value));
              setFrom(fromShown);
            }}
          >
            {versions.map((v) => (
              <option key={v.id} value={v.version_number}>
                v{v.version_number} · {formatDate(v.created_at)}
              </option>
            ))}
          </select>
        </label>
        {s && (
          <a className="button primary small" href={docUrl}>
            Download release notes (.docx)
          </a>
        )}
        {isFetching && <span className="hint-text">Working…</span>}
      </div>
      {error && <div className="error-text">{error instanceof ApiRequestError ? error.message : "Couldn't make the summary"}</div>}
      {s && (
        <div className="mdf-summary-body">
          <p className="hint-text">
            {s.from_version
              ? `From v${s.from_version} (${formatDateTime(s.from_at)}) to v${s.to_version} (${formatDateTime(s.to_at)})`
              : `Everything up to v${s.to_version} (${formatDateTime(s.to_at)})`}
            {!picked && s.from_version && s.from_version === s.last_release_version && " — since the last release"}
          </p>
          <h3 className="as-h5">Release notes</h3>
          {s.versions.filter((v) => v.release_notes).length === 0 ? (
            <p className="hint-text">None written for these versions — write them on the Plan tab.</p>
          ) : (
            s.versions
              .filter((v) => v.release_notes)
              .reverse()
              .map((v) => (
                <div key={v.version_number} className="mdf-summary-notes">
                  <strong>v{v.version_number}</strong>
                  <div>{v.release_notes}</div>
                </div>
              ))
          )}
          <h3 className="as-h5">What changed</h3>
          <Changes changes={s.changes} />
          <h3 className="as-h5">Goals</h3>
          {s.goals.length === 0 ? (
            <p className="hint-text">No goals set.</p>
          ) : (
            <ul className="mdf-summary-goals">
              {s.goals.map((g, i) => (
                <li key={i} className={g.done ? "done" : undefined}>
                  {g.done ? "✔" : "☐"} {g.text}
                  {g.done && (
                    <span className="hint-text">
                      {" "}
                      — reached {formatDate(g.done_at)}
                      {g.in_period && " (in this stretch)"}
                      {g.note && `: ${g.note}`}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
          {s.status_moves.length > 0 && (
            <>
              <h3 className="as-h5">Status</h3>
              <ul>
                {s.status_moves.map((m, i) => (
                  <li key={i}>
                    {formatDateTime(m.at)}: {m.from} → {m.to}
                    {m.by && <span className="hint-text"> · {m.by}</span>}
                  </li>
                ))}
              </ul>
            </>
          )}
          {s.log.length > 0 && (
            <>
              <h3 className="as-h5">Progress log</h3>
              {s.log.map((e, i) => (
                <div key={i} className={`mdf-summary-log ${e.kind}`}>
                  <span className="hint-text">
                    {e.kind === "release" ? "Release" : "Progress"} · {formatDateTime(e.at)}
                    {e.by && ` · ${e.by}`}
                  </span>
                  <div>{e.text}</div>
                </div>
              ))}
            </>
          )}
          <h3 className="as-h5">Contents of v{s.to_version}</h3>
          <ul className="mdf-summary-contents">
            {s.contents.map((p) => (
              <li key={p.platform}>
                <strong>{p.platform}</strong> v{p.platform_version}
                <span className="hint-text">
                  {" "}
                  — {p.emitters.length ? p.emitters.map((e) => `${e.name} v${e.version}`).join(", ") : "no Emitters"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
