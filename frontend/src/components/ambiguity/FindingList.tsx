import { useEffect, useRef } from "react";
import type { AmbiguityFinding } from "../../api/ambiguity";
import { SeverityBadge } from "./SeverityBadge";
import { PARAMS, findingStatus, limitingParam, overlapPct, pct, priLabel } from "./ambiguityText";

const STATUS_MARK = { open: "", acknowledged: "✓", merged: "⇄" } as const;
const STATUS_TITLE = { open: "", acknowledged: "Acknowledged", merged: "Modes merged" } as const;

/** One line per pair: severity, the two Modes, and what still tells them
 * apart — the deciding parameter in bold, any other partial ones after it;
 * parameters that overlap fully aren't repeated on every line. */
export function FindingList({
  findings,
  selectedId,
  onSelect,
  showEmitter,
  goneModeIds,
  changed,
}: {
  findings: AmbiguityFinding[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  showEmitter: boolean;
  /** Modes merged away since this check — their findings will go on the next run. */
  goneModeIds: Set<string>;
  /** Modes edited or deleted since the check. */
  changed: Map<string, "changed" | "gone">;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.querySelector(".finding-item.selected")?.scrollIntoView({ block: "nearest" });
  }, [selectedId]);

  if (findings.length === 0) return <p className="hint-text finding-list-empty">No pairs match these filters.</p>;

  return (
    <div className="finding-list" ref={listRef} aria-label="Pairs">
      {findings.map((f) => {
        const status = findingStatus(f);
        const limiting = limitingParam(f);
        const gone = status !== "merged" && (goneModeIds.has(f.mode_id_a) || goneModeIds.has(f.mode_id_b));
        const edited = changed.has(f.mode_id_a) || changed.has(f.mode_id_b);
        const partial = PARAMS.filter(({ key }) => key !== limiting && (overlapPct(f, key) ?? 100) < 99.95);
        const name = (key: (typeof PARAMS)[number]["key"], label: string) => (key === "pri" ? priLabel(f) : label);
        return (
          <button
            type="button"
            key={f.id}
            className={`finding-item${f.id === selectedId ? " selected" : ""}${status !== "open" || gone ? " handled" : ""}`}
            onClick={() => onSelect(f.id)}
          >
            <SeverityBadge severity={f.combined_severity} short />
            <span className="finding-item-names">
              {f.details.mode_a.mode_name}
              {showEmitter && <span className="hint-text"> · {f.details.mode_a.emitter_name}</span>}
              <span className="finding-item-vs"> ↔ </span>
              {f.details.mode_b.mode_name}
              {showEmitter && <span className="hint-text"> · {f.details.mode_b.emitter_name}</span>}
            </span>
            <span className="finding-item-overlaps">
              <b>
                {name(limiting, PARAMS.find((p) => p.key === limiting)?.label ?? limiting)} {pct(overlapPct(f, limiting))}
              </b>
              {partial.map(({ key, label }) => (
                <span key={key}>
                  {name(key, label)} {pct(overlapPct(f, key))}
                </span>
              ))}
              {partial.length === 0 && <span className="hint-text">rest full</span>}
            </span>
            <span className="finding-item-status" title={STATUS_TITLE[status]}>
              {(gone || edited) && (
                <span className="finding-changed-dot changed" title={gone ? "A Mode was merged away since" : "A Mode was edited since the check"} />
              )}
              {f.ai_explanation && <span className="ai-mark" title="Has an AI explanation">✦</span>}
              {STATUS_MARK[status]}
            </span>
          </button>
        );
      })}
    </div>
  );
}
