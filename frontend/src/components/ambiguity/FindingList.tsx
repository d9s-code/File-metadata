import { useEffect, useRef, type KeyboardEvent } from "react";
import type { AmbiguityFinding } from "../../api/ambiguity";
import { SeverityBadge } from "./SeverityBadge";
import { PARAMS, findingStatus, limitingParam, overlapPct, pct, priLabel } from "./ambiguityText";

const STATUS_MARK = { open: "", acknowledged: "✓", merged: "⇄" } as const;
const STATUS_TITLE = { open: "", acknowledged: "Acknowledged", merged: "Modes merged" } as const;

/** One line per finding: severity, the pair, the overlap per parameter (the
 * one that set the severity in bold) and what's been done. Arrow keys move
 * through it. */
export function FindingList({
  findings,
  selectedId,
  onSelect,
  showEmitter,
  goneModeIds,
}: {
  findings: AmbiguityFinding[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  showEmitter: boolean;
  /** Modes merged away since this check — their findings will go on the next run. */
  goneModeIds: Set<string>;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.querySelector(".finding-item.selected")?.scrollIntoView({ block: "nearest" });
  }, [selectedId]);

  function onKeyDown(e: KeyboardEvent) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const i = findings.findIndex((f) => f.id === selectedId);
    const next = e.key === "ArrowDown" ? Math.min(findings.length - 1, i + 1) : Math.max(0, i - 1);
    if (findings[next]) onSelect(findings[next].id);
  }

  if (findings.length === 0) return <p className="hint-text finding-list-empty">No findings match these filters.</p>;

  return (
    <div className="finding-list" ref={listRef} tabIndex={0} onKeyDown={onKeyDown} aria-label="Findings">
      {findings.map((f) => {
        const status = findingStatus(f);
        const limiting = limitingParam(f);
        const gone = status !== "merged" && (goneModeIds.has(f.mode_id_a) || goneModeIds.has(f.mode_id_b));
        return (
          <button
            type="button"
            key={f.id}
            className={`finding-item${f.id === selectedId ? " selected" : ""}${status !== "open" || gone ? " handled" : ""}`}
            onClick={() => onSelect(f.id)}
          >
            <span className="finding-item-sev">
              <SeverityBadge severity={f.combined_severity} />
            </span>
            <span className="finding-item-pair">
              <span className="finding-item-names">
                {f.details.mode_a.mode_name}
                {showEmitter && <span className="hint-text"> · {f.details.mode_a.emitter_name}</span>}
                <span className="finding-item-vs"> ↔ </span>
                {f.details.mode_b.mode_name}
                {showEmitter && <span className="hint-text"> · {f.details.mode_b.emitter_name}</span>}
              </span>
              <span className="finding-item-overlaps">
                {PARAMS.map(({ key, label }) => {
                  const v = overlapPct(f, key);
                  if (v == null) return null;
                  return (
                    <span key={key} className={key === limiting ? "limiting" : undefined}>
                      {key === "pri" ? priLabel(f) : label} {pct(v)}
                    </span>
                  );
                })}
                {gone && <span className="finding-item-gone">a Mode was merged away</span>}
              </span>
            </span>
            <span className="finding-item-status" title={STATUS_TITLE[status]}>
              {f.ai_explanation && <span className="ai-mark" title="Has an AI explanation">✦</span>}
              {STATUS_MARK[status]}
            </span>
          </button>
        );
      })}
    </div>
  );
}
