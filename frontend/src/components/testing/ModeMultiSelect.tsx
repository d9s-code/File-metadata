export interface ModeNameOption {
  id: string;
  name: string;
}

/** Chips for the chosen Modes plus a dropdown to add another. */
export function ModeMultiSelect({
  modes,
  selected,
  onChange,
  disabled,
}: {
  modes: ModeNameOption[];
  selected: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
}) {
  const nameOf = new Map(modes.map((m) => [m.id, m.name]));
  const available = modes.filter((m) => !selected.includes(m.id));
  return (
    <div className="mode-multi-select">
      {selected.map((id) => (
        <span key={id} className="mode-chip mode-chip-selected-static">
          {nameOf.get(id) ?? "(deleted Mode)"}
          {!disabled && (
            <button
              type="button"
              className="chip-remove"
              aria-label={`Remove ${nameOf.get(id) ?? "Mode"}`}
              onClick={() => onChange(selected.filter((s) => s !== id))}
            >
              ×
            </button>
          )}
        </span>
      ))}
      {!disabled && available.length > 0 && (
        <select
          value=""
          aria-label="Add an intercepted Mode"
          onChange={(e) => e.target.value && onChange([...selected, e.target.value])}
        >
          <option value="">{selected.length ? "+ add" : "+ add Mode…"}</option>
          {available.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      )}
      {modes.length === 0 && <span className="hint-text">No Modes on this Emitter</span>}
    </div>
  );
}
