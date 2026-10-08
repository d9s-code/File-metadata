import type { Source } from "../../types/domain";

/** The Sources a Mode comes from — one or more, in order: each as a chip
 * (× takes it off, the last one stays), and a select to add another. */
export function SourcesPicker({
  sources,
  value,
  onChange,
  invalid,
}: {
  sources: Source[];
  value: string[];
  onChange: (ids: string[]) => void;
  invalid?: boolean;
}) {
  const byId = new Map(sources.map((s) => [s.id, s]));
  const rest = sources.filter((s) => !value.includes(s.id));
  return (
    <span className="sources-picker">
      {value.map((id) => (
        <span key={id} className="source-chip">
          {byId.get(id)?.name ?? "?"}
          {value.length > 1 && (
            <button
              type="button"
              className="link-button"
              aria-label={`Remove ${byId.get(id)?.name ?? "Source"}`}
              onClick={() => onChange(value.filter((v) => v !== id))}
            >
              ×
            </button>
          )}
        </span>
      ))}
      {rest.length > 0 && (
        <select
          value=""
          aria-label={value.length ? "Add another Source" : "Source"}
          aria-invalid={invalid || undefined}
          onChange={(e) => e.target.value && onChange([...value, e.target.value])}
        >
          <option value="">{value.length ? "+ another Source…" : "Pick one…"}</option>
          {rest.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      )}
    </span>
  );
}
