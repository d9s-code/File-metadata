import { useEffect, useMemo, useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiRequestError } from "../../api/client";
import { mdfPlanApi, type ChangeNote, type ChangeNotes } from "../../api/mdfPlan";
import { useMdfs } from "../../state/hooks/useMdfs";
import { useAppSettings, useUpdateAppSettings } from "../../state/hooks/useDwells";

type Rule = { key: string; label: string; hint?: string };

/** What can count in change notes — the same keys as the backend's
 * change_notes.COUNTS_DEFAULT, with what's on out of the box. */
export const CHANGE_NOTE_RULES: { title: string; rules: Rule[] }[] = [
  {
    title: "What's listed",
    rules: [
      { key: "platforms", label: "Platforms added or removed" },
      { key: "emitters", label: "Emitters added or removed" },
      { key: "modes", label: "Modes added or removed" },
      { key: "platform_moves", label: "Emitters moved onto or off a Platform", hint: "a Platform both versions have" },
      { key: "dwell_files", label: "Dwell files added, removed or changed" },
    ],
  },
  {
    title: "A Mode's values",
    rules: [
      { key: "name", label: "Name" },
      { key: "pri_type", label: "PRI type" },
      { key: "rf", label: "RF" },
      { key: "pw", label: "PW" },
      { key: "pri", label: "PRI" },
      { key: "jitter", label: "Jitter" },
      { key: "stagger", label: "Stagger", hint: "steps and frame time" },
      { key: "threat_priority", label: "Threat priority" },
      { key: "ageout", label: "Ageout" },
      { key: "confirmation", label: "Confirmation" },
      { key: "scan_period", label: "Scan period" },
      { key: "range_matching", label: "Range matching" },
    ],
  },
  {
    title: "How values compare",
    rules: [
      {
        key: "deltas",
        label: "As exported, deltas applied",
        hint: "off: as typed, so a change to a delta alone doesn't count",
      },
    ],
  },
];

const BUILT_IN_OFF = new Set(["confirmation", "scan_period", "range_matching"]);
const KEYS = CHANGE_NOTE_RULES.flatMap((g) => g.rules.map((r) => r.key));
const BUILT_IN: Record<string, boolean> = Object.fromEntries(KEYS.map((k) => [k, !BUILT_IN_OFF.has(k)]));
const onKeys = (counts: Record<string, boolean>) => KEYS.filter((k) => counts[k]);

type Mark = "same" | "shown" | "hidden";
interface MarkedNote {
  kind: ChangeNote["kind"];
  name: string;
  detail?: string | null;
  mark: Mark;
  items: { text: string; mark: Mark }[];
}

/** The notes as the draft rules write them, beside the saved rules': lines
 * only the draft has are marked "shown", lines only the saved rules have
 * "hidden". */
function merge(draft: ChangeNote[], saved: ChangeNote[]): MarkedNote[] {
  const key = (n: ChangeNote) => `${n.kind}\u0000${n.name}`;
  const savedBy = new Map(saved.map((n) => [key(n), n]));
  const draftKeys = new Set(draft.map(key));
  const out: MarkedNote[] = draft.map((n) => {
    const before = savedBy.get(key(n));
    if (!before) return { ...n, mark: "shown", items: (n.items ?? []).map((text) => ({ text, mark: "shown" })) };
    const had = new Set(before.items ?? []);
    const has = new Set(n.items ?? []);
    return {
      ...n,
      mark: "same",
      items: [
        ...(n.items ?? []).map((text) => ({ text, mark: (had.has(text) ? "same" : "shown") as Mark })),
        ...(before.items ?? []).filter((t) => !has.has(t)).map((text) => ({ text, mark: "hidden" as Mark })),
      ],
    };
  });
  for (const n of saved) {
    if (!draftKeys.has(key(n))) out.push({ ...n, mark: "hidden", items: (n.items ?? []).map((text) => ({ text, mark: "hidden" })) });
  }
  return out;
}

function countMarks(sections: MarkedNote[][]) {
  let shown = 0;
  let hidden = 0;
  for (const n of sections.flat()) {
    const lines = [n.mark, ...n.items.filter(() => n.mark === "same").map((i) => i.mark)];
    shown += lines.filter((m) => m === "shown").length;
    hidden += lines.filter((m) => m === "hidden").length;
  }
  return { shown, hidden };
}

const TAG: Record<Mark, string | null> = { same: null, shown: "now shown", hidden: "now hidden" };

function Preview({ draft, saved }: { draft: ChangeNotes; saved: ChangeNotes }) {
  const sections: [string, "added" | "removed" | "changed", MarkedNote[]][] = [
    ["Added", "added", merge(draft.added, saved.added)],
    ["Removed", "removed", merge(draft.removed, saved.removed)],
    ["Updated", "changed", merge(draft.updated, saved.updated)],
  ];
  const { shown, hidden } = countMarks(sections.map(([, , notes]) => notes));
  const anyLine = sections.some(([, , notes]) => notes.length);
  return (
    <>
      <p className="hint-text counts-preview-tally" aria-live="polite">
        {shown || hidden
          ? [shown && `${shown} line${shown === 1 ? "" : "s"} now shown`, hidden && `${hidden} now hidden`]
              .filter(Boolean)
              .join(" · ") + " — against the saved setting."
          : "Reads the same as with the saved setting."}
      </p>
      {!anyLine && <p className="hint-text">No major changes.</p>}
      <div className="change-notes">
        {sections
          .filter(([, , notes]) => notes.length)
          .map(([title, kind, notes]) => (
            <div key={title}>
              <h4 className="change-notes-heading">{title}</h4>
              <ul className="mdf-changes">
                {notes.map((n) => (
                  <li key={`${n.kind}-${n.name}`} className={`mdf-change ${kind} counts-${n.mark}`}>
                    <span className="mdf-change-mark" aria-hidden>
                      {kind === "added" ? "+" : kind === "removed" ? "−" : "~"}
                    </span>
                    <span>
                      <span className="counts-line">
                        <span className="hint-text">{n.kind}</span> <strong>{n.name}</strong>
                        {n.detail && <span className="hint-text"> — {n.detail}</span>}
                      </span>
                      {TAG[n.mark] && <span className={`counts-tag counts-tag-${n.mark}`}>{TAG[n.mark]}</span>}
                      {n.items.length > 0 && (
                        <ul className="change-notes-items">
                          {n.items.map((item) => (
                            <li key={item.text} className={n.mark === "same" ? `counts-${item.mark}` : undefined}>
                              <span className="counts-line">{item.text}</span>
                              {n.mark === "same" && TAG[item.mark] && (
                                <span className={`counts-tag counts-tag-${item.mark}`}>{TAG[item.mark]}</span>
                              )}
                            </li>
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
    </>
  );
}

function useSummaryWith(mdfId: string, counts: Record<string, boolean> | null) {
  const on = counts ? onKeys(counts) : [];
  return useQuery({
    queryKey: ["mdf-summary", mdfId, "counts", on.join(",")],
    queryFn: () => mdfPlanApi.summary(mdfId, null, null, on),
    enabled: !!mdfId && !!counts,
    placeholderData: keepPreviousData,
    retry: false,
  });
}

/** Admin › Defaults: what counts in change notes, one toggle per rule, with
 * an MDF's change notes beside them as they'd read — lines a toggle would
 * add or take away marked against the saved setting. */
export function ChangeNotesCountsCard() {
  const qc = useQueryClient();
  const { data: settings } = useAppSettings();
  const update = useUpdateAppSettings();
  const { data: mdfs } = useMdfs();
  const saved = settings?.change_notes_counts ?? null;
  const [draft, setDraft] = useState<Record<string, boolean> | null>(null);
  const [mdfId, setMdfId] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (saved && draft === null) setDraft(saved);
  }, [saved, draft]);

  const choices = useMemo(() => (mdfs ?? []).filter((m) => !m.is_deleted), [mdfs]);
  // By default an MDF that follows another — what change notes are mostly for.
  const picked = mdfId || (choices.find((m) => m.based_on_mdf_id) ?? choices[0])?.id || "";
  const draftQ = useSummaryWith(picked, draft);
  const savedQ = useSummaryWith(picked, saved);

  if (!saved || !draft) return null;
  const changed = KEYS.filter((k) => draft[k] !== saved[k]);
  const builtIn = KEYS.every((k) => draft[k] === BUILT_IN[k]);

  async function save() {
    setMessage(null);
    setError(null);
    try {
      const out = await update.mutateAsync({ change_notes_counts: draft! });
      setDraft(out.change_notes_counts);
      await qc.invalidateQueries({ queryKey: ["mdf-summary"] });
      setMessage("Saved — summaries and release notes count these.");
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Couldn't save them.");
    }
  }

  const s = draftQ.data;
  const span = s
    ? s.from_mdf
      ? `${s.from_mdf.name} v${s.from_mdf.version} → v${s.to_version}`
      : s.from_version
        ? `v${s.from_version} → v${s.to_version}`
        : `Everything up to v${s.to_version}`
    : null;
  const loadError = draftQ.error ?? savedQ.error;

  return (
    <section className="card">
      <h2 className="as-h4">Change notes — what counts</h2>
      <p className="hint-text">
        What an MDF&apos;s summary and release notes list as its major changes. Version numbers moving with nothing
        else changed, notes, Sources and statuses never count. Try a toggle and see the change notes on the right change
        before saving.
      </p>
      <div className="counts-layout">
        <div>
          {CHANGE_NOTE_RULES.map((g) => (
            <fieldset key={g.title} className="defaults-group counts-group">
              <legend>{g.title}</legend>
              {g.rules.map((r) => (
                <label key={r.key} className="checkbox-label counts-rule">
                  <input
                    type="checkbox"
                    checked={draft[r.key]}
                    onChange={(e) => {
                      setDraft({ ...draft, [r.key]: e.target.checked });
                      setMessage(null);
                    }}
                  />
                  <span>
                    {r.label}
                    {draft[r.key] !== saved[r.key] && (
                      <span className="counts-unsaved" title="Not saved yet">
                        <span aria-hidden> ●</span>
                        <span className="sr-only"> (not saved yet)</span>
                      </span>
                    )}
                    {r.hint && <span className="hint-text counts-hint">{r.hint}</span>}
                  </span>
                </label>
              ))}
            </fieldset>
          ))}
          <div className="form-row">
            <button
              type="button"
              className="button primary"
              onClick={() => void save()}
              disabled={update.isPending || changed.length === 0}
            >
              {update.isPending
                ? "Saving…"
                : changed.length
                  ? `Save ${changed.length} change${changed.length === 1 ? "" : "s"}`
                  : "Saved"}
            </button>
            {changed.length > 0 && (
              <button type="button" className="button secondary" onClick={() => setDraft(saved)}>
                Discard
              </button>
            )}
            {!builtIn && (
              <button type="button" className="button secondary" onClick={() => setDraft(BUILT_IN)}>
                Back to the built-in rules
              </button>
            )}
          </div>
          {message && <p className="success-text">{message}</p>}
          {error && (
            <p className="error-text" role="alert">
              {error}
            </p>
          )}
        </div>
        <div className="counts-preview">
          <div className="counts-preview-head">
            <label>
              Preview with
              <select value={picked} onChange={(e) => setMdfId(e.target.value)} disabled={!choices.length}>
                {choices.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                    {m.based_on_mdf_name ? ` (follows ${m.based_on_mdf_name})` : ""}
                  </option>
                ))}
              </select>
            </label>
            {span && <span className="hint-text">{span}</span>}
            {(draftQ.isFetching || savedQ.isFetching) && <span className="hint-text">Updating…</span>}
          </div>
          {!choices.length ? (
            <p className="hint-text">No MDFs to preview with yet.</p>
          ) : loadError ? (
            <p className="hint-text">
              {loadError instanceof ApiRequestError ? loadError.message : "Couldn't make its change notes."}
            </p>
          ) : draftQ.data && savedQ.data ? (
            <Preview draft={draftQ.data.change_notes} saved={savedQ.data.change_notes} />
          ) : (
            <p className="hint-text">Making its change notes…</p>
          )}
        </div>
      </div>
    </section>
  );
}
