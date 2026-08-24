import type { DiffResult } from "../../api/emitterVersions";

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  return String(value);
}

export function DiffViewer({ diff }: { diff: DiffResult }) {
  if (diff.identical) {
    return <p className="hint-text">No differences between these versions.</p>;
  }

  return (
    <div className="diff-viewer">
      {diff.changed.length > 0 && (
        <div className="diff-section">
          <h5>Changed</h5>
          {diff.changed.map((entry, i) => (
            <div key={i} className="diff-row diff-changed">
              <code className="diff-path">{entry.path}</code>
              <div className="diff-values">
                <pre className="diff-old">{formatValue(entry.old_value)}</pre>
                <span>→</span>
                <pre className="diff-new">{formatValue(entry.new_value)}</pre>
              </div>
            </div>
          ))}
        </div>
      )}
      {diff.added.length > 0 && (
        <div className="diff-section">
          <h5>Added</h5>
          {diff.added.map((entry, i) => (
            <div key={i} className="diff-row diff-added">
              <code className="diff-path">{entry.path}</code>
              <pre>{formatValue(entry.value)}</pre>
            </div>
          ))}
        </div>
      )}
      {diff.removed.length > 0 && (
        <div className="diff-section">
          <h5>Removed</h5>
          {diff.removed.map((entry, i) => (
            <div key={i} className="diff-row diff-removed">
              <code className="diff-path">{entry.path}</code>
              <pre>{formatValue(entry.value)}</pre>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
