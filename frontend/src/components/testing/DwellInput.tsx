import { useEffect, useState } from "react";
import { useDwellStrategies } from "../../state/hooks/useDwells";

export const MANUAL_DWELL = "Manual";

type Kind = "manual" | "value" | "strategy";

/** A run's dwell: "Manual", a value written in (e.g. "50 ms"), or — when
 * `onStrategy` is given — a Dwell Strategy (its latest saved version is
 * recorded; `value` then reads e.g. "Patrol v2"). */
export function DwellInput({
  value,
  onChange,
  strategyVersionId = "",
  onStrategy,
  platformId,
}: {
  value: string;
  onChange: (value: string) => void;
  strategyVersionId?: string;
  /** Picks a Strategy version ("" for none); the page sets the dwell text to `label` too. */
  onStrategy?: (versionId: string, label: string) => void;
  /** Only this Platform's Strategies (and the default dwells). */
  platformId?: string;
}) {
  const { data: strategies } = useDwellStrategies(platformId, true);
  const isManual = value === MANUAL_DWELL;
  const [kind, setKind] = useState<Kind>(strategyVersionId ? "strategy" : isManual ? "manual" : "value");
  // Keeps what was typed, so switching to Manual and back doesn't lose it.
  const [written, setWritten] = useState(isManual || strategyVersionId ? "" : value);
  // A value set from outside (a draft, or copied from a previous run) decides the kind.
  useEffect(() => {
    if (strategyVersionId) setKind("strategy");
    else if (isManual) setKind((k) => (k === "strategy" ? k : "manual"));
    else {
      setKind((k) => (k === "strategy" ? k : "value"));
      setWritten(value);
    }
  }, [strategyVersionId, isManual, value]);

  const offered = (strategies ?? []).filter((s) => s.latest_version_id);
  const canPick = !!onStrategy && (offered.length > 0 || !!strategyVersionId);
  const known = offered.some((s) => s.latest_version_id === strategyVersionId);

  function pickKind(next: Kind) {
    setKind(next);
    if (next !== "strategy" && strategyVersionId) onStrategy?.("", "");
    if (next === "manual") onChange(MANUAL_DWELL);
    if (next === "value") onChange(written);
    if (next === "strategy") onChange("");
  }

  // Default dwells first, then by Platform(s).
  const groups = new Map<string, typeof offered>();
  for (const s of offered) {
    const key = s.is_default ? "Default dwells" : s.platform_names.join(", ");
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }

  return (
    <label>
      Dwell
      <span className="dwell-input">
        <select aria-label="Dwell type" value={kind} onChange={(e) => pickKind(e.target.value as Kind)}>
          <option value="manual">Manual</option>
          <option value="value">Value…</option>
          {canPick && <option value="strategy">Strategy…</option>}
        </select>
        {kind === "value" && (
          <input
            aria-label="Dwell value"
            placeholder="e.g. 50 ms"
            maxLength={100}
            value={value}
            onChange={(e) => {
              setWritten(e.target.value);
              onChange(e.target.value);
            }}
            required
          />
        )}
        {kind === "strategy" && (
          <select
            aria-label="Dwell Strategy"
            value={strategyVersionId}
            required
            onChange={(e) => {
              const s = offered.find((o) => o.latest_version_id === e.target.value);
              onStrategy?.(e.target.value, s ? `${s.name} v${s.latest_version_number}` : "");
            }}
          >
            <option value="">— Pick the Strategy —</option>
            {strategyVersionId && !known && <option value={strategyVersionId}>{value || "As picked before"}</option>}
            {[...groups.entries()].map(([platform, items]) =>
              platformId && groups.size === 1 ? (
                items.map((s) => (
                  <option key={s.id} value={s.latest_version_id ?? ""}>
                    {s.name} (v{s.latest_version_number})
                  </option>
                ))
              ) : (
                <optgroup key={platform} label={platform}>
                  {items.map((s) => (
                    <option key={s.id} value={s.latest_version_id ?? ""}>
                      {s.name} (v{s.latest_version_number})
                    </option>
                  ))}
                </optgroup>
              ),
            )}
          </select>
        )}
      </span>
    </label>
  );
}
