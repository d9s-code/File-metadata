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

/** A row of the page tree: a copied page, or a place above some (a
 * collection, or a page with no text of its own) that isn't copied itself. */
export interface OutlineNode {
  path: string;
  depth: number;
  page: DocumentationPage | null;
  /** How many rows are under it, at any depth. */
  under: number;
}

/** Every page with every place above it, parents before their children
 * (siblings in the order the pages came), so each level can be opened. */
export function outlineTree(pages: DocumentationPage[]): OutlineNode[] {
  const byPath = new Map(pages.map((p) => [p.path, p]));
  const children = new Map<string, string[]>();
  const known = new Set<string>();
  const roots: string[] = [];
  const add = (path: string) => {
    if (known.has(path)) return;
    known.add(path);
    const parts = path.split(SEP);
    if (parts.length === 1) {
      roots.push(path);
      return;
    }
    const parent = parts.slice(0, -1).join(SEP);
    add(parent);
    children.set(parent, [...(children.get(parent) ?? []), path]);
  };
  for (const p of pages) add(p.path);
  const out: OutlineNode[] = [];
  const walk = (path: string, depth: number): number => {
    const node: OutlineNode = { path, depth, page: byPath.get(path) ?? null, under: 0 };
    out.push(node);
    for (const c of children.get(path) ?? []) node.under += 1 + walk(c, depth + 1);
    return node.under;
  };
  for (const r of roots) walk(r, 0);
  return out;
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
  // Pages whose sub-pages are shown; the rest show folded (top level only, to start).
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
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
  const all = outlineTree(pages.data.pages);
  const parents = new Set(all.filter((n) => n.under > 0).map((n) => n.path));
  // Searching shows every match; otherwise a row shows when every level above it is open.
  const shown = words.length
    ? all.filter((n) => words.every((w) => n.path.toLowerCase().includes(w)))
    : all.filter((n) => {
        const parts = n.path.split(SEP);
        return parts.slice(0, -1).every((_, i) => expanded.has(parts.slice(0, i + 1).join(SEP)));
      });
  const toggle = (path: string) => {
    const next = new Set(expanded);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    setExpanded(next);
  };

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

  const row = (p: OutlineNode) => {
    const depth = p.depth;
    const own = p.path in edits ? edits[p.path] : (saved[p.path] ?? null);
    const parent = p.path.split(SEP).slice(0, -1).join(SEP);
    const inherited = parent ? kindOf(parent, rules, fallback) : fallback;
    const kind = own ?? inherited;
    return (
      <tr key={p.path} className={kind === "exclude" ? "doc-kind-excluded" : undefined}>
        <td title={p.path} className="doc-kinds-page" style={{ paddingLeft: `${0.5 + depth * 1.1}rem` }}>
          {parents.has(p.path) && !words.length ? (
            <button
              type="button"
              className="link-button doc-kinds-toggle"
              aria-expanded={expanded.has(p.path)}
              aria-label={`${expanded.has(p.path) ? "Fold" : "Show"} the pages under ${p.path}`}
              onClick={() => toggle(p.path)}
            >
              {expanded.has(p.path) ? "▾" : "▸"}
            </button>
          ) : (
            <span className="doc-kinds-toggle" />
          )}
          {p.path.split(SEP).pop()}
          {parents.has(p.path) && !expanded.has(p.path) && !words.length && (
            <span className="hint-text"> · {p.under} under it</span>
          )}
        </td>
        <td className="num hint-text" title={p.page ? undefined : "No text of its own — what you set here applies to the pages under it"}>
          {p.page ? p.page.sections : "—"}
        </td>
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
      <h3 className="as-h5">What lives where</h3>
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
          <div className="doc-kinds-tools">
            <input
              type="search"
              className="doc-kinds-filter"
              placeholder="Find a page…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              aria-label="Find a page"
            />
            <button type="button" className="button secondary small" onClick={() => setExpanded(new Set(parents))}>
              Expand all
            </button>
            <button type="button" className="button secondary small" onClick={() => setExpanded(new Set())}>
              Collapse all
            </button>
          </div>
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
