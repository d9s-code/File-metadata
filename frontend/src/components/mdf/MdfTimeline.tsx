import { useMemo, useState } from "react";
import { ApiRequestError } from "../../api/client";
import { mdfPlanApi, type PinChange, type TimelineEvent, type TimelineKind } from "../../api/mdfPlan";
import type { MdfVersionSummary } from "../../api/mdfVersions";
import { useMdfSummary, useMdfTimeline } from "../../state/hooks/useMdfPlan";
import { formatDate, formatDateTime } from "../common/dates";
import { LoadingState } from "../common/LoadingState";
import { useSessionState } from "../common/useSessionState";

const KINDS: [TimelineKind | "all", string][] = [
  ["all", "All"],
  ["version", "Versions"],
  ["status", "Status"],
  ["goal", "Goals"],
  ["log", "Log"],
  ["pins", "Pins"],
  ["due", "Due date"],
  ["details", "Details"],
];
const KIND_LABEL: Record<TimelineKind, string> = {
  version: "Version",
  status: "Status",
  pins: "Pins",
  goal: "Goal",
  log: "Log",
  due: "Due date",
  created: "Created",
  details: "Details",
};

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

function Event({ e }: { e: TimelineEvent }) {
  const [open, setOpen] = useState(false);
  const changes = e.changes ?? [];
  return (
    <li className={`mdf-event ${e.kind}${e.log_kind ? ` ${e.log_kind}` : ""}`}>
      <div className="mdf-event-dot" aria-hidden />
      <div className="mdf-event-body">
        <div className="mdf-event-head">
          <span className={`status-badge mdf-event-kind ${e.kind}`}>
            {e.kind === "log" ? (e.log_kind === "release" ? "Release note" : "Progress") : KIND_LABEL[e.kind]}
          </span>
          <strong>{e.title}</strong>
          <span className="hint-text">
            {formatDateTime(e.at)}
            {e.by && ` · ${e.by}`}
          </span>
        </div>
        {e.kind === "due" && e.due && (
          <div className="hint-text">
            {e.due.old ? formatDate(e.due.old) : "none"} → {e.due.new ? formatDate(e.due.new) : "none"}
          </div>
        )}
        {e.text && e.kind !== "version" && <div className="mdf-event-text">{e.text}</div>}
        {e.kind === "version" && (
          <>
            {e.text && <div className="mdf-event-text">{e.text}</div>}
            {e.release_notes && (
              <div className="mdf-event-release">
                <span className="hint-text">Release notes</span>
                <div>{e.release_notes}</div>
              </div>
            )}
            <button type="button" className="link-button" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
              {open ? "▾" : "▸"} {changes.length} change{changes.length === 1 ? "" : "s"} since the version before
            </button>
            {open && <Changes changes={changes} />}
          </>
        )}
      </div>
    </li>
  );
}

/** "Summarize…": what changed between two saved versions (by default since
 * the last release), with its release notes, goals, status moves and log —
 * on the page, or as a Word document (the release notes). */
function SummaryPanel({ mdfId, versions, onClose }: { mdfId: string; versions: MdfVersionSummary[]; onClose: () => void }) {
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
        <h4>Summary</h4>
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
          <h5>Release notes</h5>
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
          <h5>What changed</h5>
          <Changes changes={s.changes} />
          <h5>Goals</h5>
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
              <h5>Status</h5>
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
              <h5>Progress log</h5>
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
          <h5>Contents of v{s.to_version}</h5>
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

/** Everything that happened to an MDF, newest first — versions with what
 * changed, status moves, goals, the log, pins and due-date moves. */
export function MdfTimeline({ mdfId, versions }: { mdfId: string; versions: MdfVersionSummary[] }) {
  const { data, isLoading, error } = useMdfTimeline(mdfId);
  const [kind, setKind] = useSessionState<TimelineKind | "all">("mdfTimeline.kind", "all");
  const [summarizing, setSummarizing] = useState(false);
  const events = useMemo(
    () => (data?.events ?? []).filter((e) => kind === "all" || e.kind === kind || (kind === "details" && e.kind === "created")),
    [data, kind],
  );
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const e of data?.events ?? []) c[e.kind === "created" ? "details" : e.kind] = (c[e.kind === "created" ? "details" : e.kind] ?? 0) + 1;
    return c;
  }, [data]);

  return (
    <div className="mdf-timeline-tab">
      {summarizing && <SummaryPanel mdfId={mdfId} versions={versions} onClose={() => setSummarizing(false)} />}
      <section className="card">
        <div className="card-header">
          <h4>Timeline</h4>
          <span className="section-actions">
            <button
              type="button"
              className="button secondary small"
              disabled={versions.length === 0 || summarizing}
              title={versions.length === 0 ? "Save a version first" : "What changed between two versions — and the release notes document"}
              onClick={() => setSummarizing(true)}
            >
              Summarize…
            </button>
          </span>
        </div>
        <div className="mdf-timeline-filters" role="group" aria-label="Show">
          {KINDS.map(([k, label]) => (
            <button
              key={k}
              type="button"
              className={`recording-chip${kind === k ? " active" : ""}`}
              aria-pressed={kind === k}
              onClick={() => setKind(k)}
              disabled={k !== "all" && !counts[k]}
            >
              {label}
              {k !== "all" && counts[k] ? <span className="hint-text"> {counts[k]}</span> : null}
            </button>
          ))}
        </div>
        {isLoading ? (
          <LoadingState label="Loading the timeline…" />
        ) : error ? (
          <div className="error-text">{(error as Error).message}</div>
        ) : events.length === 0 ? (
          <p className="hint-text">Nothing here yet.</p>
        ) : (
          <ol className="mdf-timeline">
            {events.map((e, i) => (
              <Event key={`${e.kind}-${e.at}-${i}`} e={e} />
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
