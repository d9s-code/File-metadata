import { Fragment, useState, type ReactNode } from "react";
import { ApiRequestError } from "../../api/client";
import { Link } from "react-router-dom";
import {
  mdfPlanApi,
  type ChangeLog,
  type ChangeLogBlock,
  type ChangeLogDetail,
  type ChangeLogGroup,
  type ChangeNote,
  type ChangeNotes,
  type PlainDraft,
  type SummaryFrom,
  type SummaryPart,
} from "../../api/mdfPlan";
import type { MdfVersionSummary } from "../../api/mdfVersions";
import { useAuth } from "../../auth/AuthContext";
import { useAiStatus } from "../../state/hooks/useAmbiguity";
import { useMdfSummary } from "../../state/hooks/useMdfPlan";
import { formatDate, formatDateTime } from "../common/dates";

/** The change notes: what was added, removed and updated in what's
 * delivered — major changes only. */
export function ChangeNotesList({ notes }: { notes: ChangeNotes }) {
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

const MARKS = { added: "+", removed: "−", updated: "~" } as const;
const MARK_CLASS = { added: "added", removed: "removed", updated: "changed" } as const;

/** The change log as it reads at the detail and grouping asked for — the
 * same blocks the release-notes document writes. */
export function ChangeLogView({ log }: { log: ChangeLog }) {
  // Lines that follow each other are one list.
  const runs: (ChangeLogBlock | ChangeLogBlock[])[] = [];
  for (const b of log.blocks) {
    const last = runs[runs.length - 1];
    if (b.type === "line" && Array.isArray(last)) last.push(b);
    else runs.push(b.type === "line" ? [b] : b);
  }
  return (
    <div className="change-notes">
      {runs.map((r, i) =>
        Array.isArray(r) ? (
          <ul key={i} className="mdf-changes">
            {r.map((b, j) => (
              <li key={j} className={`mdf-change ${b.mark ? MARK_CLASS[b.mark] : ""}`}>
                <span className="mdf-change-mark" aria-hidden>
                  {b.mark ? MARKS[b.mark] : "·"}
                </span>
                <span>
                  {b.text}
                  {b.items.length > 0 && (
                    <ul className="change-notes-items">
                      {b.items.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  )}
                </span>
              </li>
            ))}
          </ul>
        ) : r.type === "heading" ? (
          <h4 key={i} className="change-notes-heading">
            {r.text}
          </h4>
        ) : (
          <p key={i} className={r.type === "empty" ? "hint-text" : "change-log-paragraph"}>
            {r.text}
          </p>
        ),
      )}
    </div>
  );
}

interface Layout {
  detail: ChangeLogDetail;
  group: ChangeLogGroup;
  parts: SummaryPart[];
}

const LAYOUT_KEY = "mdf-summary-layout";
const ALL_PARTS: SummaryPart[] = ["meta", "release_notes", "contents"];
const DEFAULT_LAYOUT: Layout = { detail: "full", group: "change", parts: ALL_PARTS };

/** How the summary was last laid out, in this browser. */
function readLayout(): Layout {
  try {
    const v = JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? "null") as Partial<Layout> | null;
    if (!v) return DEFAULT_LAYOUT;
    return {
      detail: (["full", "names", "counts", "sentences"] as const).includes(v.detail as ChangeLogDetail) ? (v.detail as ChangeLogDetail) : "full",
      group: v.group === "platform" ? "platform" : "change",
      parts: Array.isArray(v.parts) ? ALL_PARTS.filter((p) => v.parts!.includes(p)) : ALL_PARTS,
    };
  } catch {
    return DEFAULT_LAYOUT;
  }
}

function saveLayout(l: Layout) {
  try {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(l));
  } catch {
    // Not kept; fine.
  }
}

const DETAILS: [ChangeLogDetail, string][] = [
  ["full", "Full detail"],
  ["names", "Names only"],
  ["counts", "Counts only"],
  ["sentences", "Plain sentences"],
];
const PART_LABELS: [SummaryPart, string][] = [
  ["meta", "Versions & details"],
  ["release_notes", "Release notes"],
  ["contents", "Contents table"],
];

function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** "Summarize…": the change notes between two saved versions (by default
 * since the last release — or, before this MDF has one, since the MDF it
 * follows), with the release notes written for them and the contents of the
 * later version — on the page, or as a Word document (the release notes).
 * Laid out as picked — the change log's detail and grouping, which parts go
 * in (remembered in this browser) — and, with the AI, the release notes in
 * plain words: a draft to edit, used in place of those written when ticked. */
export function SummaryPanel({ mdfId, versions, onClose }: { mdfId: string; versions: MdfVersionSummary[]; onClose: () => void }) {
  const [from, setFrom] = useState<SummaryFrom>(null);
  const [to, setTo] = useState<number | null>(null);
  const [picked, setPicked] = useState(false);
  const [layout, setLayoutState] = useState<Layout>(readLayout);
  const setLayout = (part: Partial<Layout>) =>
    setLayoutState((l) => {
      const next = { ...l, ...part };
      saveLayout(next);
      return next;
    });
  const { data: s, isFetching, error } = useMdfSummary(mdfId, picked ? from : null, picked ? to : null, true, { detail: layout.detail, group: layout.group });
  // What the server took — for an end not picked (yet), its default.
  const fromServer: SummaryFrom = s?.from_mdf ? "previous" : (s?.from_version ?? "start");
  const fromShown: SummaryFrom = picked && from !== null ? from : fromServer;
  const toShown = picked && to !== null ? to : (s?.to_version ?? null);
  const { user } = useAuth();
  const aiOn = (useAiStatus().data?.enabled ?? false) && (user?.preferences.ai_drafts ?? true);
  const [draft, setDraft] = useState<(PlainDraft & { edited: string }) | null>(null);
  const [useDraft, setUseDraft] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const has = (p: SummaryPart) => layout.parts.includes(p);
  // A draft is of one span: another span, and it's gone.
  const span = `${fromShown}-${toShown}`;
  const [draftSpan, setDraftSpan] = useState<string | null>(null);
  const draftNow = draft && draftSpan === span ? draft : null;
  const usingDraft = useDraft && !!draftNow && draftNow.edited.trim().length > 0;

  async function makeDraft() {
    setActionError(null);
    setDrafting(true);
    try {
      const d = await mdfPlanApi.plainDraft(mdfId, fromShown, toShown);
      setDraft({ ...d, edited: d.text });
      setDraftSpan(span);
      setUseDraft(true);
    } catch (err) {
      setActionError(err instanceof ApiRequestError ? err.message : "Couldn't get a draft");
    } finally {
      setDrafting(false);
    }
  }

  async function download() {
    if (!s) return;
    setActionError(null);
    setDownloading(true);
    try {
      const blob = await mdfPlanApi.summaryDocx(mdfId, {
        from: fromShown,
        to: toShown,
        detail: layout.detail,
        group: layout.group,
        parts: layout.parts,
        releaseNotesText: usingDraft ? draftNow!.edited : null,
      });
      save(blob, `${s.mdf.name} release notes v${s.to_version}.docx`);
    } catch (err) {
      setActionError(err instanceof ApiRequestError ? err.message : "Couldn't make the document");
    } finally {
      setDownloading(false);
    }
  }

  const written = s?.versions.filter((v) => v.release_notes) ?? [];
  const section = (title: string, body: ReactNode) => (
    <Fragment>
      <h3 className="as-h5">{title}</h3>
      {body}
    </Fragment>
  );

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
          <button type="button" className="button primary small" disabled={downloading} onClick={() => void download()}>
            {downloading ? "Making it…" : "Download release notes (.docx)"}
          </button>
        )}
        {isFetching && <span className="hint-text">Working…</span>}
      </div>
      <div className="mdf-summary-layout" role="group" aria-label="How it reads">
        <label>
          Change notes
          <select value={layout.detail} aria-label="Change notes detail" onChange={(e) => setLayout({ detail: e.target.value as ChangeLogDetail })}>
            {DETAILS.map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Grouped
          <select value={layout.group} aria-label="Change notes grouping" onChange={(e) => setLayout({ group: e.target.value as ChangeLogGroup })}>
            <option value="change">By change (added, removed, updated)</option>
            <option value="platform">By Platform</option>
          </select>
        </label>
        <span className="mdf-summary-parts">
          {PART_LABELS.map(([p, label]) => (
            <label key={p} className="inline-check">
              <input
                type="checkbox"
                checked={has(p)}
                onChange={(e) => setLayout({ parts: e.target.checked ? ALL_PARTS.filter((x) => x === p || layout.parts.includes(x)) : layout.parts.filter((x) => x !== p) })}
              />
              {label}
            </label>
          ))}
        </span>
        {aiOn && s && (
          <button type="button" className="button secondary small" disabled={drafting} onClick={() => void makeDraft()} title="The AI rewrites the release notes and change notes in plain words — a draft for you to edit">
            {drafting ? "Drafting…" : draftNow ? "Draft again in plain words (AI)" : "Plain-language draft (AI)"}
          </button>
        )}
      </div>
      {error && <div className="error-text">{error instanceof ApiRequestError ? error.message : "Couldn't make the summary"}</div>}
      {actionError && <div className="error-text">{actionError}</div>}
      {draftNow && (
        <div className="mdf-summary-draft">
          <div className="mdf-summary-draft-head">
            <strong>Plain-language draft</strong>
            <span className="hint-text">
              AI draft ({draftNow.model}) — check it against the change notes below before using it.
            </span>
          </div>
          {draftNow.unverified_numbers.length > 0 && (
            <p className="mode-form-warning">Numbers it wrote that aren&apos;t in the summary: {draftNow.unverified_numbers.join(", ")} — check them.</p>
          )}
          <textarea
            rows={7}
            value={draftNow.edited}
            aria-label="Plain-language release notes"
            onChange={(e) => setDraft({ ...draftNow, edited: e.target.value })}
          />
          <label className="inline-check">
            <input type="checkbox" checked={useDraft} onChange={(e) => setUseDraft(e.target.checked)} />
            Use it in place of the release notes written (on the page and in the document)
          </label>
        </div>
      )}
      {s && (
        <div className="mdf-summary-body">
          {has("meta") && (
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
          )}
          {has("release_notes") &&
            section(
              "Release notes",
              usingDraft ? (
                <div className="mdf-summary-notes plain">
                  {draftNow!.edited
                    .split(/\n\s*\n/)
                    .filter((p) => p.trim())
                    .map((p, i) => (
                      <p key={i}>{p.trim()}</p>
                    ))}
                </div>
              ) : written.length === 0 ? (
                <p className="hint-text">None written for these versions — write them on the Plan tab.</p>
              ) : (
                [...written].reverse().map((v) => (
                  <div key={v.version_number} className="mdf-summary-notes">
                    <strong>v{v.version_number}</strong>
                    <div>{v.release_notes}</div>
                  </div>
                ))
              ),
            )}
          {section("Change notes", s.change_log ? <ChangeLogView log={s.change_log} /> : <ChangeNotesList notes={s.change_notes} />)}
          {has("contents") &&
            section(
              `Contents of v${s.to_version}`,
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
              </ul>,
            )}
        </div>
      )}
    </section>
  );
}
