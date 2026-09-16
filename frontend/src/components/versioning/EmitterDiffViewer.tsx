import type { EmitterDiffEntry, EmitterDiffResult } from "../../types/versioning";

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (Array.isArray(value)) return value.map(formatValue).join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function groupByScope(entries: EmitterDiffEntry[]): Map<string, EmitterDiffEntry[]> {
  const groups = new Map<string, EmitterDiffEntry[]>();
  for (const entry of entries) {
    const bucket = groups.get(entry.scope);
    if (bucket) bucket.push(entry);
    else groups.set(entry.scope, [entry]);
  }
  return groups;
}

export function EmitterDiffViewer({ diff }: { diff: EmitterDiffResult }) {
  if (diff.identical) {
    return <p className="hint-text">No differences between these versions.</p>;
  }

  const groups = groupByScope(diff.entries);

  return (
    <div className="diff-viewer">
      {[...groups.entries()].map(([scope, entries]) => (
        <div key={scope} className="diff-section">
          <h5>{scope}</h5>
          {entries.map((entry, i) => (
            <div key={i} className={`diff-row diff-${entry.kind}`}>
              <span className="diff-field-label">{entry.label}</span>
              {entry.kind === "changed" ? (
                <div className="diff-values">
                  <pre className="diff-old">{formatValue(entry.old_value)}</pre>
                  <span>→</span>
                  <pre className="diff-new">{formatValue(entry.new_value)}</pre>
                </div>
              ) : (
                <span className="diff-badge">{entry.kind === "added" ? "Added" : "Removed"}</span>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
