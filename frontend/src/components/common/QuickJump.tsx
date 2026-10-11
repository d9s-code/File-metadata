import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { searchApi, type SearchHit, type SearchKind } from "../../api/search";

const KIND_LABEL: Record<SearchKind, string> = {
  emitter: "Emitters",
  mode: "Modes",
  source: "Sources",
  platform: "Platforms",
  mdf: "MDFs",
  intercept: "Intercepts",
};
const KIND_ORDER: SearchKind[] = ["emitter", "mode", "platform", "mdf", "source", "intercept"];
const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** The menu bar's search: a button, and Ctrl+K (⌘K) from anywhere, open a box
 * that finds Emitters, Modes, Platforms, MDFs, Sources and Intercepts by name
 * and jumps to the one picked. */
export function QuickJump() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <>
      <button
        type="button"
        className="quick-jump-button"
        onClick={() => setOpen(true)}
        title="Find an Emitter, Mode, Platform, MDF, Source or Intercept"
      >
        <span aria-hidden>⌕</span> Search <kbd>{IS_MAC ? "⌘K" : "Ctrl K"}</kbd>
      </button>
      {open && <QuickJumpBox onClose={() => setOpen(false)} />}
    </>
  );
}

function QuickJumpBox({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const term = useDebounced(q.trim(), 150);
  const { data, isFetching } = useQuery({
    queryKey: ["quick-jump", term],
    queryFn: () => searchApi.search(term),
    enabled: term.length > 0,
    staleTime: 10_000,
  });
  // Grouped by kind, in a fixed order; the flat list is what the arrow keys move through.
  const groups = useMemo(() => {
    const hits = term ? (data ?? []) : [];
    return KIND_ORDER.map((kind) => ({ kind, hits: hits.filter((h) => h.kind === kind) })).filter((g) => g.hits.length);
  }, [data, term]);
  const flat = useMemo(() => groups.flatMap((g) => g.hits), [groups]);
  useEffect(() => setActive(0), [term]);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    listRef.current?.querySelector(".quick-jump-hit.active")?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function go(hit: SearchHit) {
    onClose();
    navigate(hit.url);
  }

  return (
    <div className="quick-jump-backdrop" onMouseDown={onClose}>
      <div
        className="quick-jump-box"
        role="dialog"
        aria-label="Search"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <input
          autoFocus
          className="quick-jump-input"
          placeholder="Find an Emitter, Mode, Platform, MDF, Source or Intercept…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
            else if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, flat.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === "Enter" && flat[active]) {
              e.preventDefault();
              go(flat[active]);
            }
          }}
          aria-label="Search"
        />
        <div className="quick-jump-results" ref={listRef}>
          {!term ? (
            <p className="hint-text">
              Type a name or designation — every word has to match. ↑↓ to move, Enter to open, Esc to close.
            </p>
          ) : groups.length === 0 ? (
            <p className="hint-text">{isFetching ? "Searching…" : `Nothing named like “${term}”.`}</p>
          ) : (
            groups.map((g) => (
              <div key={g.kind} className="quick-jump-group">
                <div className="quick-jump-group-label">{KIND_LABEL[g.kind]}</div>
                {g.hits.map((h) => {
                  const i = flat.indexOf(h);
                  return (
                    <button
                      type="button"
                      key={`${h.kind}:${h.id}`}
                      className={i === active ? "quick-jump-hit active" : "quick-jump-hit"}
                      onMouseEnter={() => setActive(i)}
                      onClick={() => go(h)}
                    >
                      <span className="quick-jump-title">{h.title}</span>
                      {h.subtitle && <span className="quick-jump-subtitle">{h.subtitle}</span>}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
