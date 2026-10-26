import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ambiguityApi, type DocumentationPage } from "../../api/ambiguity";
import { ApiRequestError } from "../../api/client";
import { useAppSettings, useUpdateAppSettings } from "../../state/hooks/useDwells";

const SEP = " › ";

/** A page's kind with the edits not saved yet: its own, else the nearest page above with one. */
function kindOf(path: string, rules: Record<string, string>, fallback: string): string {
  const parts = path.split(SEP);
  for (let n = parts.length; n > 0; n--) {
    const kind = rules[parts.slice(0, n).join(SEP)];
    if (kind) return kind;
  }
  return fallback;
}

/** What lives where in Outline: for each copied page (its sub-pages
 * following), whether it's documentation, a test result, analysis — or left
 * out. The AI is told which each section is, so it doesn't take one test
 * for how the sensor always behaves. */
export function DocumentationKinds() {
  const qc = useQueryClient();
  const pages = useQuery({ queryKey: ["documentationPages"], queryFn: () => ambiguityApi.documentationPages() });
  const settings = useAppSettings();
  const update = useUpdateAppSettings();
  const saved = useMemo(() => settings.data?.outline_page_kinds ?? {}, [settings.data]);
  const [edits, setEdits] = useState<Record<string, string | null>>({});
  const [filter, setFilter] = useState("");
  const [error, setError] = useState<string | null>(null);

  const rules = useMemo(() => {
    const next = { ...saved };
    for (const [path, kind] of Object.entries(edits)) {
      if (kind) next[path] = kind;
      else delete next[path];
    }
    return next;
  }, [saved, edits]);
  const changed = Object.keys(edits).filter((p) => (edits[p] ?? undefined) !== saved[p]).length;

  if (pages.isLoading || !settings.data) return <p className="hint-text">Loading the pages…</p>;
  if (pages.isError || !pages.data) return <p className="error-text">Couldn&apos;t load the pages.</p>;
  const { kinds, default: fallback } = pages.data;
  const label = (key: string) => kinds.find((k) => k.key === key)?.label ?? key;
  const words = filter.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = pages.data.pages.filter((p) => words.every((w) => p.path.toLowerCase().includes(w)));

  async function save() {
    setError(null);
    try {
      await update.mutateAsync({ outline_page_kinds: rules });
      setEdits({});
      void qc.invalidateQueries({ queryKey: ["documentationPages"] });
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Couldn't save it");
    }
  }

  const row = (p: DocumentationPage) => {
    const depth = p.path.split(SEP).length - 1;
    const own = p.path in edits ? edits[p.path] : (saved[p.path] ?? null);
    const parent = p.path.split(SEP).slice(0, -1).join(SEP);
    const inherited = parent ? kindOf(parent, rules, fallback) : fallback;
    const kind = own ?? inherited;
    return (
      <tr key={p.path} className={kind === "exclude" ? "doc-kind-excluded" : undefined}>
        <td title={p.path} style={{ paddingLeft: `${0.5 + depth * 1.1}rem` }}>
          {p.path.split(SEP).pop()}
        </td>
        <td className="num hint-text">{p.sections}</td>
        <td>
          <select
            aria-label={`What ${p.path} holds`}
            value={own ?? ""}
            onChange={(e) => setEdits({ ...edits, [p.path]: e.target.value || null })}
          >
            <option value="">{parent ? `As above — ${label(inherited)}` : `${label(fallback)} (default)`}</option>
            {kinds.map((k) => (
              <option key={k.key} value={k.key} title={k.meaning}>
                {k.label}
              </option>
            ))}
          </select>
        </td>
      </tr>
    );
  };

  return (
    <div className="doc-kinds">
      <h4>What lives where</h4>
      <p className="hint-text">
        Say what each page holds; its sub-pages follow unless set themselves. The AI is told which each section is:{" "}
        {kinds
          .filter((k) => k.key !== "exclude")
          .map((k) => `${k.label.toLowerCase()} — ${k.meaning}`)
          .join("; ")}
        . It reports a test result as that test&apos;s finding, never as proof of how the sensor always behaves.{" "}
        <em>Leave out</em> keeps a page from the AI altogether.
      </p>
      {pages.data.pages.length === 0 ? (
        <p className="hint-text">No pages copied yet — Sync now, then set them here.</p>
      ) : (
        <>
          <input
            type="search"
            className="doc-kinds-filter"
            placeholder="Find a page…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            aria-label="Find a page"
          />
          <div className="table-scroll doc-kinds-scroll">
            <table className="data-table compact">
              <thead>
                <tr>
                  <th>Page</th>
                  <th className="num">Sections</th>
                  <th>Holds</th>
                </tr>
              </thead>
              <tbody>{shown.map(row)}</tbody>
            </table>
          </div>
          <div className="form-row">
            <button type="button" className="button primary" disabled={changed === 0 || update.isPending} onClick={() => void save()}>
              {update.isPending ? "Saving…" : changed ? `Save ${changed} change${changed === 1 ? "" : "s"}` : "Saved"}
            </button>
            {changed > 0 && (
              <button type="button" className="button secondary" onClick={() => setEdits({})}>
                Discard
              </button>
            )}
            {error && <span className="error-text">{error}</span>}
          </div>
        </>
      )}
    </div>
  );
}
