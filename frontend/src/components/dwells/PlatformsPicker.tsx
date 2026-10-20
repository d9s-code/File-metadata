import { useState } from "react";

/** Which Platforms a Dwell Strategy covers: tick any number — none makes it
 * a default dwell, tied to no Platform. */
export function PlatformsPicker({
  value,
  onChange,
  platforms,
}: {
  value: string[];
  onChange: (ids: string[]) => void;
  platforms: { id: string; name: string }[];
}) {
  const [filter, setFilter] = useState("");
  const sorted = [...platforms].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const needle = filter.trim().toLowerCase();
  const shown = needle ? sorted.filter((p) => p.name.toLowerCase().includes(needle) || value.includes(p.id)) : sorted;

  function toggle(id: string) {
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  }

  return (
    <fieldset className="platforms-picker">
      <legend>Platforms</legend>
      {platforms.length > 8 && (
        <input
          type="search"
          placeholder="Find a Platform…"
          aria-label="Find a Platform"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      )}
      <div className="platforms-picker-list">
        {shown.map((p) => (
          <label key={p.id} className="checkbox-label">
            <input type="checkbox" checked={value.includes(p.id)} onChange={() => toggle(p.id)} />
            {p.name}
          </label>
        ))}
        {platforms.length === 0 && <span className="hint-text">No Platforms yet.</span>}
      </div>
      <span className="hint-text">
        {value.length === 0
          ? "None ticked: a default dwell — not tied to any Platform."
          : `Covers ${value.length} Platform${value.length === 1 ? "" : "s"}.`}
      </span>
    </fieldset>
  );
}
