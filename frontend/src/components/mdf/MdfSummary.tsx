import { useState } from "react";
import { ApiRequestError } from "../../api/client";
import { Link } from "react-router-dom";
import { mdfPlanApi, type ChangeNote, type ChangeNotes, type SummaryFrom } from "../../api/mdfPlan";
import type { MdfVersionSummary } from "../../api/mdfVersions";
import { useMdfSummary } from "../../state/hooks/useMdfPlan";
import { formatDate, formatDateTime } from "../common/dates";

/** The change notes: what was added, removed and updated in what's
 * delivered — major changes only. */
function ChangeNotesList({ notes }: { notes: ChangeNotes }) {
  if (!notes.added.length && !notes.removed.length && !notes.updated.length) {
    return <p className="hint-text">No major changes.</p>;
  }
  const sections: [string, string, ChangeNote[]][] = [
    ["Added", "added", notes.added],
    ["Removed", "removed", notes.removed],
    ["Updated", "changed", notes.updated],
  ];
  return (
    <div className="change-notes">
      {sections
        .filter(([, , entries]) => entries.length)
        .map(([title, kind, entries]) => (
          <div key={title}>
            <h4 className="change-notes-heading">{title}</h4>
            <ul className="mdf-changes">
              {entries.map((e, i) => (
                <li key={i} className={`mdf-change ${kind}`}>
                  <span className="mdf-change-mark" aria-hidden>
                    {kind === "added" ? "+" : kind === "removed" ? "−" : "~"}
                  </span>
                  <span>
                    <span className="hint-text">{e.kind}</span> <strong>{e.name}</strong>
                    {e.detail && <span className="hint-text"> — {e.detail}</span>}
                    {e.items && e.items.length > 0 && (
                      <ul className="change-notes-items">
                        {e.items.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
    </div>
  );
}

/** "Summarize…": the change notes between two saved versions (by default
 * since the last release — or, before this MDF has one, since the MDF it
 * follows), with the release notes written for them and the contents of the
 * later version — on the page, or as a Word document (the release notes). */
export function SummaryPanel({ mdfId, versions, onClose }: { mdfId: string; versions: MdfVersionSummary[]; onClose: () => void }) {
  const [from, setFrom] = useState<SummaryFrom>(null);
  const [to, setTo] = useState<number | null>(null);
  const [picked, setPicked] = useState(false);
  const { data: s, isFetching, error } = useMdfSummary(mdfId, picked ? from : null, picked ? to : null, true);
  const fromShown: SummaryFrom = picked ? from : s?.from_mdf ? "previous" : (s?.from_version ?? "start");
  const toShown = picked ? to : (s?.to_version ?? null);
  const docUrl = mdfPlanApi.summaryDocxUrl(mdfId, s?.from_mdf ? "previous" : (s?.from_version ?? "start"), s?.to_version ?? null);
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
            value={fromShown ?? "start"}
            onChange={(e) => {
              const v = e.target.value;
              setPicked(true);
              setFrom(v === "start" || v === "previous" ? v : Number(v));
              setTo(toShown);
            }}
          >
            <option value="start">The start</option>
            {s?.previous_mdf && (
              <option value="previous">
                The previous MDF: {s.previous_mdf.name} v{s.previous_mdf.version}
              </option>
            )}
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
            {s.from_mdf ? (
              <>
                From the previous MDF, <Link to={`/mdfs/${s.from_mdf.id}`}>{s.from_mdf.name}</Link> v{s.from_mdf.version} (
                {formatDateTime(s.from_mdf.at)}), to v{s.to_version} ({formatDateTime(s.to_at)})
              </>
            ) : s.from_version ? (
              `From v${s.from_version} (${formatDateTime(s.from_at)}) to v${s.to_version} (${formatDateTime(s.to_at)})`
            ) : (
              `Everything up to v${s.to_version} (${formatDateTime(s.to_at)})`
            )}
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
          <h3 className="as-h5">Change notes</h3>
          <ChangeNotesList notes={s.change_notes} />
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
