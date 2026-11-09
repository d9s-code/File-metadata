import type { AmbiguitySeverity } from "../../api/ambiguity";
import type { FindingGroup } from "./ambiguityAnalysis";
import { PARAMS, SEVERITY_LABEL, SEVERITY_ORDER } from "./ambiguityText";

/** The counts by severity as one bar — wide segments where most are. */
export function SeverityBar({ counts, total }: { counts: Record<AmbiguitySeverity, number>; total: number }) {
  return (
    <span
      className="sev-bar"
      role="img"
      aria-label={SEVERITY_ORDER.filter((s) => counts[s])
        .map((s) => `${counts[s]} ${SEVERITY_LABEL[s]}`)
        .join(", ")}
    >
      {SEVERITY_ORDER.filter((s) => counts[s]).map((s) => (
        <i key={s} className={`sev-seg sev-${s}`} style={{ flex: counts[s] / Math.max(total, 1) }} />
      ))}
    </span>
  );
}

const paramLabel = (k: string) => PARAMS.find((p) => p.key === k)?.label ?? k;

/** The groups to work through, worst first, with every pair at the top. */
export function GroupList({
  groups,
  total,
  totalOpen,
  selectedKey,
  onSelect,
}: {
  groups: FindingGroup[];
  total: number;
  totalOpen: number;
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
}) {
  return (
    <nav className="group-list" aria-label="Groups">
      <button type="button" className={selectedKey === null ? "group-item all selected" : "group-item all"} onClick={() => onSelect(null)}>
        <span className="group-item-title">Every pair</span>
        <span className="group-item-meta hint-text">
          {total} pair{total === 1 ? "" : "s"} · {totalOpen} open · {groups.length} group{groups.length === 1 ? "" : "s"}
        </span>
      </button>
      {groups.map((g) => (
        <button
          type="button"
          key={g.key}
          className={`group-item${g.key === selectedKey ? " selected" : ""}${g.open === 0 ? " handled" : ""}`}
          onClick={() => onSelect(g.key)}
          title={g.modes.map((m) => m.name).join(", ")}
        >
          <span className="group-item-top">
            <span className={`sev-dot sev-${g.worst}`} title={SEVERITY_LABEL[g.worst]} />
            <span className="group-item-title">{g.label}</span>
            <span className="group-item-open figure" title="Open pairs">
              {g.open || "✓"}
            </span>
          </span>
          <SeverityBar counts={g.counts} total={g.findings.length} />
          <span className="group-item-meta hint-text">
            {g.kind === "emitters" ? `${g.modes.length} Modes` : `${g.modes.length} Modes${g.emitters.length > 1 ? ` · ${g.emitters.length} Emitters` : ""}`}{" "}
            · {g.findings.length} pair{g.findings.length === 1 ? "" : "s"} · mostly {paramLabel(g.deciding)}
          </span>
        </button>
      ))}
    </nav>
  );
}
