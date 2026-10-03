import type { EmitterDiffEntry, EmitterDiffResult } from "../../types/versioning";

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.map(formatValue).join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/** "Mode 'Search 1'" → ["Mode", "Search 1"]; "Emitter" → ["Emitter", null]. */
function splitScope(scope: string): [string, string | null] {
  const m = scope.match(/^(.*?) '(.*)'$/);
  return m ? [m[1], m[2]] : [scope, null];
}

function groupByScope(entries: EmitterDiffEntry[]): [string, EmitterDiffEntry[]][] {
  const groups = new Map<string, EmitterDiffEntry[]>();
  for (const entry of entries) {
    const bucket = groups.get(entry.scope);
    if (bucket) bucket.push(entry);
    else groups.set(entry.scope, [entry]);
  }
  return [...groups];
}

/** "2 fields changed · 1 added · 1 removed". */
export function changeCounts(entries: EmitterDiffEntry[]) {
  const changed = entries.filter((e) => e.kind === "changed").length;
  const added = entries.filter((e) => e.kind === "added").length;
  const removed = entries.filter((e) => e.kind === "removed").length;
  return [
    changed > 0 && `${changed} field${changed === 1 ? "" : "s"} changed`,
    added > 0 && `${added} added`,
    removed > 0 && `${removed} removed`,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** What changed between two versions (or since the last one), item by item:
 * each Mode, EW Group, Source, pin… with its changed fields as before → after,
 * and what was added or removed with a line saying what it was. Used for
 * Emitters, Platforms and MDFs alike. */
export function EmitterDiffViewer({ diff }: { diff: EmitterDiffResult }) {
  if (diff.identical || diff.entries.length === 0) {
    return <p className="hint-text">No differences between these versions.</p>;
  }

  return (
    <div className="change-list">
      {groupByScope(diff.entries).map(([scope, entries]) => {
        const [kind, name] = splitScope(scope);
        const whole = entries.find((e) => e.kind !== "changed");
        const fields = entries.filter((e) => e.kind === "changed");
        return (
          <section key={scope} className={whole ? `change-group ${whole.kind}` : "change-group"}>
            <div className="change-group-head">
              <span className="change-item-kind">{kind}</span>
              {name && <strong className="change-item-name">{name}</strong>}
              {whole && <span className={`change-badge ${whole.kind}`}>{whole.label}</span>}
            </div>
            {whole && formatValue(whole.kind === "added" ? whole.new_value : whole.old_value) !== "—" && (
              <p className="change-item-summary">{formatValue(whole.kind === "added" ? whole.new_value : whole.old_value)}</p>
            )}
            {fields.length > 0 && (
              <div className="change-fields">
                {fields.map((entry, i) => (
                  <div key={i} className="change-field">
                    <span className="change-field-label">{entry.label}</span>
                    <span className="change-old">{formatValue(entry.old_value)}</span>
                    <span className="change-arrow" aria-label="changed to">
                      →
                    </span>
                    <span className="change-new">{formatValue(entry.new_value)}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
