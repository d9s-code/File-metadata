/** The release notes, previewed as the Word file will read: the options
 * down the side — the versions, how the change notes read, the parts that go
 * in, the Platforms and Emitters tables (their columns, every row or only
 * those added or updated) and a plain-language draft by the AI — and the
 * document drawn as a page, from the very blocks the Word file writes. */
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ApiRequestError } from "../api/client";
import {
  mdfPlanApi,
  type ChangeLogDetail,
  type ChangeLogGroup,
  type DocBlock,
  type PlainDraft,
  type SummaryFrom,
  type SummaryPart,
  type SummaryTables,
} from "../api/mdfPlan";
import { useAuth } from "../auth/AuthContext";
import { BackLink } from "../components/common/BackLink";
import { formatDate } from "../components/common/dates";
import { LoadingState } from "../components/common/LoadingState";
import { ALL_PARTS, DETAILS, PART_LABELS, readLayout, saveFile, saveLayout, type Layout } from "../components/mdf/summaryLayout";
import { useAiStatus } from "../state/hooks/useAmbiguity";
import { useMdfSummary } from "../state/hooks/useMdfPlan";
import { useMdf } from "../state/hooks/useMdfs";
import { useMdfVersions } from "../state/hooks/useMdfVersions";

/** The same colours the Word file uses: the row's tint, the change cell's fill, its text. */
const MARK_COLOURS = {
  added: ["#F3FAF5", "#DDF2E3", "#1E7B34"],
  removed: ["#FDF3F2", "#FADCD9", "#B3261E"],
  updated: ["#FFFAEC", "#FCEFC7", "#8A5A00"],
} as const;

function cellText(c: string | string[]): string | string[] {
  return Array.isArray(c) ? (c.length > 1 ? c.map((x) => `• ${x}`) : (c[0] ?? "")) : c;
}

function DocTable({ b }: { b: DocBlock }) {
  const [head, ...rows] = b.rows;
  const total = b.widths.length ? b.widths.reduce((a, w) => a + w, 0) : 0;
  return (
    <table className="doc-table" style={b.font_pt ? { fontSize: `${b.font_pt}pt` } : undefined}>
      {total > 0 && (
        <colgroup>
          {b.widths.map((w, i) => (
            <col key={i} style={{ width: `${(w / total) * 100}%` }} />
          ))}
        </colgroup>
      )}
      <thead>
        <tr>
          {head.map((c, i) => (
            <th key={i}>{c as string}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, r) => {
          const mark = b.marks[r] ?? null;
          const [tint, fill, ink] = mark ? MARK_COLOURS[mark] : [undefined, undefined, undefined];
          return (
            <tr key={r} data-mark={mark ?? undefined}>
              {row.map((c, i) => {
                const strong = mark && i === b.mark_column;
                const text = cellText(c);
                return (
                  <td key={i} style={{ background: strong ? fill : tint, color: strong ? ink : undefined, fontWeight: strong ? 700 : undefined }}>
                    {Array.isArray(text) ? text.map((line, k) => <div key={k}>{line}</div>) : text}
                  </td>
                );
              })}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** The document, as a page. */
export function DocPage({ blocks }: { blocks: DocBlock[] }) {
  return (
    <article className="doc-page" aria-label="Release notes preview">
      {blocks.map((b, i) => {
        switch (b.kind) {
          case "title":
            return (
              <h1 key={i} className="doc-title">
                {b.text}
              </h1>
            );
          case "h1":
            return (
              <h2 key={i} className="doc-h1">
                {b.text}
              </h2>
            );
          case "h2":
            return (
              <h3 key={i} className="doc-h2">
                {b.text}
              </h3>
            );
          case "meta":
            return (
              <p key={i} className="doc-meta">
                {b.text}
              </p>
            );
          case "bullet":
            return (
              <p key={i} className="doc-bullet">
                • {b.text}
              </p>
            );
          case "table":
            return <DocTable key={i} b={b} />;
          default:
            return (
              <p key={i} className="doc-p">
                {b.text}
              </p>
            );
        }
      })}
    </article>
  );
}

/** The value typed, a moment after the typing stops. */
function useSettled<T>(value: T, ms = 400): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return settled;
}

function Columns({
  title,
  columns,
  shown,
  onChange,
}: {
  title: string;
  columns: Record<string, string>;
  shown: string[];
  onChange: (next: string[]) => void;
}) {
  const keys = Object.keys(columns);
  return (
    <fieldset className="release-columns">
      <legend>{title} columns</legend>
      {keys.map((k) => (
        <label key={k} className="inline-check">
          <input
            type="checkbox"
            checked={shown.includes(k)}
            onChange={(e) => onChange(e.target.checked ? keys.filter((x) => x === k || shown.includes(x)) : shown.filter((x) => x !== k))}
          />
          {columns[k]}
        </label>
      ))}
    </fieldset>
  );
}

export function ReleaseNotesPage() {
  const { mdfId = "" } = useParams<{ mdfId: string }>();
  const { data: mdf } = useMdf(mdfId);
  const { data: versions } = useMdfVersions(mdfId);
  const [from, setFrom] = useState<SummaryFrom>(null);
  const [to, setTo] = useState<number | null>(null);
  const [layout, setLayoutState] = useState<Layout>(readLayout);
  const setLayout = (part: Partial<Layout>) =>
    setLayoutState((l) => {
      const next = { ...l, ...part };
      saveLayout(next);
      return next;
    });
  const setTables = (part: Partial<SummaryTables>) => setLayout({ tables: { ...layout.tables, ...part } });
  const has = (p: SummaryPart) => layout.parts.includes(p);

  // The summary: the versions it spans as the server took them (its defaults for an end not picked).
  const { data: s } = useMdfSummary(mdfId, from, to, !!versions?.length, { detail: layout.detail, group: layout.group });
  const fromShown: SummaryFrom = from ?? (s?.from_mdf ? "previous" : (s?.from_version ?? "start"));
  const toShown = to ?? s?.to_version ?? null;
  const { data: columns } = useQuery({ queryKey: ["summary-columns"], queryFn: () => mdfPlanApi.summaryColumns(mdfId), enabled: !!mdfId, staleTime: Infinity });

  const { user } = useAuth();
  const aiOn = (useAiStatus().data?.enabled ?? false) && (user?.preferences.ai_drafts ?? true);
  const [draft, setDraft] = useState<(PlainDraft & { edited: string; span: string }) | null>(null);
  const [useDraft, setUseDraft] = useState(false);
  const [busy, setBusy] = useState<"draft" | "download" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const span = `${fromShown}-${toShown}`;
  const draftNow = draft && draft.span === span ? draft : null;
  const draftText = useSettled(useDraft && draftNow?.edited.trim() ? draftNow.edited : null);

  const input = useMemo(
    () => ({ from, to, detail: layout.detail, group: layout.group, parts: layout.parts, tables: layout.tables, releaseNotesText: draftText }),
    [from, to, layout, draftText],
  );
  const preview = useQuery({
    queryKey: ["mdf-summary-preview", mdfId, input],
    queryFn: () => mdfPlanApi.summaryPreview(mdfId, input),
    enabled: !!versions?.length,
    placeholderData: (previous) => previous,
  });

  async function makeDraft() {
    setActionError(null);
    setBusy("draft");
    try {
      const d = await mdfPlanApi.plainDraft(mdfId, fromShown, toShown);
      setDraft({ ...d, edited: d.text, span });
      setUseDraft(true);
    } catch (err) {
      setActionError(err instanceof ApiRequestError ? err.message : "Couldn't get a draft");
    } finally {
      setBusy(null);
    }
  }

  async function download() {
    setActionError(null);
    setBusy("download");
    try {
      const blob = await mdfPlanApi.summaryDocx(mdfId, {
        ...input,
        releaseNotesText: useDraft && draftNow?.edited.trim() ? draftNow.edited : null,
      });
      saveFile(blob, preview.data?.file_name ?? "release notes.docx");
    } catch (err) {
      setActionError(err instanceof ApiRequestError ? err.message : "Couldn't make the document");
    } finally {
      setBusy(null);
    }
  }

  if (!mdf || !versions) return <LoadingState label="Loading the release notes…" />;

  return (
    <div className="page release-notes-page">
      <BackLink to={`/mdfs/${mdf.id}?tab=plan`}>{mdf.name}</BackLink>
      <div className="emitter-title-row">
        <h1>Release notes — preview</h1>
        <div className="emitter-actions">
          <button type="button" className="button primary" disabled={!preview.data || busy === "download"} onClick={() => void download()}>
            {busy === "download" ? "Making it…" : "Download (.docx)"}
          </button>
        </div>
      </div>
      {versions.length === 0 ? (
        <p className="hint-text">Save a version of the MDF first.</p>
      ) : (
        <div className="release-notes-layout">
          <aside className="card release-notes-options" aria-label="How the release notes read">
            <section>
              <h2 className="as-h5">Versions</h2>
              <label>
                From
                <select
                  value={fromShown ?? "start"}
                  onChange={(e) => {
                    const v = e.target.value;
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
            </section>
            <section>
              <h2 className="as-h5">Change notes</h2>
              <label>
                Detail
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
                  <option value="change">By change (added, updated, removed)</option>
                  <option value="platform">By Platform</option>
                </select>
              </label>
            </section>
            <section>
              <h2 className="as-h5">In the document</h2>
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
              <p className="hint-text">The change notes are always in.</p>
            </section>
            {(has("platforms") || has("emitters")) && (
              <section>
                <h2 className="as-h5">Tables</h2>
                <fieldset className="release-columns one-column">
                  <legend>Rows</legend>
                  <label className="inline-check">
                    <input type="radio" name="table-rows" checked={layout.tables.rows === "all"} onChange={() => setTables({ rows: "all" })} />
                    All in the release
                  </label>
                  <label className="inline-check">
                    <input type="radio" name="table-rows" checked={layout.tables.rows === "changed"} onChange={() => setTables({ rows: "changed" })} />
                    Only those added or updated
                  </label>
                </fieldset>
                {columns && has("platforms") && (
                  <Columns title="Platforms" columns={columns.platforms.columns} shown={layout.tables.platform_columns} onChange={(c) => setTables({ platform_columns: c })} />
                )}
                {columns && has("emitters") && (
                  <Columns title="Emitters" columns={columns.emitters.columns} shown={layout.tables.emitter_columns} onChange={(c) => setTables({ emitter_columns: c })} />
                )}
                <p className="hint-text">RF, PRI and PW as exported (deltas applied): the lowest and highest across an Emitter&apos;s Modes.</p>
              </section>
            )}
            {aiOn && (
              <section>
                <h2 className="as-h5">Plain language (AI)</h2>
                <button type="button" className="button secondary small" disabled={busy === "draft" || !s} onClick={() => void makeDraft()}>
                  {busy === "draft" ? "Drafting…" : draftNow ? "Draft again" : "Plain-language draft"}
                </button>
                {draftNow && (
                  <div className="mdf-summary-draft">
                    <span className="hint-text">AI draft ({draftNow.model}) — check it against the change notes before using it.</span>
                    {draftNow.unverified_numbers.length > 0 && (
                      <p className="mode-form-warning">Numbers it wrote that aren&apos;t in the summary: {draftNow.unverified_numbers.join(", ")} — check them.</p>
                    )}
                    <textarea rows={8} value={draftNow.edited} aria-label="Plain-language release notes" onChange={(e) => setDraft({ ...draftNow, edited: e.target.value })} />
                    <label className="inline-check">
                      <input type="checkbox" checked={useDraft} onChange={(e) => setUseDraft(e.target.checked)} />
                      Use it in place of the release notes written
                    </label>
                  </div>
                )}
              </section>
            )}
            {actionError && <div className="error-text">{actionError}</div>}
            <p className="hint-text">
              Remembered in this browser, and used by <Link to={`/mdfs/${mdf.id}?tab=plan`}>Summarize…</Link> too.
            </p>
          </aside>
          <div className="release-notes-paper" aria-busy={preview.isFetching}>
            {preview.error ? (
              <div className="error-text">{preview.error instanceof ApiRequestError ? preview.error.message : "Couldn't make the preview"}</div>
            ) : preview.data ? (
              <DocPage blocks={preview.data.blocks} />
            ) : (
              <LoadingState label="Laying it out…" />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
