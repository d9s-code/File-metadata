import { useEffect, useRef, useState } from "react";
import { useUnsavedPins } from "../../state/hooks/useMdfPlan";
import type { PinChange } from "../../api/mdfPlan";

const KIND_MARK: Record<PinChange["kind"], string> = { added: "+", removed: "−", changed: "~" };

/** "Pins not saved — 2 changes since v3": pins are stored as soon as they
 * change, but only Save version puts them in a version — what an MDF pins
 * and what gets exported. Click for the list. Nothing shows when they match. */
export function UnsavedPinsFlag({
  kind,
  id,
  signature,
}: {
  kind: "platform" | "mdf";
  id: string;
  /** Changes whenever the pins or versions do (so the check runs again). */
  signature: string;
}) {
  const { data } = useUnsavedPins(kind, id, signature);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  if (!data || data.entries.length === 0) return null;
  const n = data.entries.length;
  const since = data.saved_version ? `since v${data.saved_version}` : "— nothing saved yet";
  const usedBy = kind === "platform" ? "MDFs pinning it and exports" : "its export and report";
  // A Platform's allegiance and speed count too: they're in its export.
  const onlyPins = data.entries.every((e) => e.scope.startsWith("Emitter '") || e.scope.startsWith("Platform '") || e.scope.startsWith("Dwell"));
  const what = onlyPins ? "Pins" : "Changes";
  return (
    <span className="unsaved-pins" ref={ref}>
      <button
        type="button"
        className="status-badge unsaved-pins-badge"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        title={`${what} ${since} — not in a saved version, so not in ${usedBy}. Save a version to include them.`}
      >
        ● {what} not saved · {n} change{n === 1 ? "" : "s"} {since}
      </button>
      {open && (
        <div className="unsaved-pins-pop" role="dialog" aria-label={`${what} not saved`}>
          <p className="hint-text">
            Stored, but not in a saved version yet — so not in {usedBy}. <strong>Save version</strong> includes them.
          </p>
          <ul>
            {data.entries.map((e, i) => (
              <li key={i} className={`unsaved-pin-${e.kind}`}>
                <span className="unsaved-pin-mark" aria-hidden>
                  {KIND_MARK[e.kind]}
                </span>
                <span>
                  <strong>{e.scope}</strong> {e.label.toLowerCase()}
                  {e.old_value && e.new_value ? ` ${e.old_value} → ${e.new_value}` : e.new_value ? ` — ${e.new_value}` : e.old_value ? ` — ${e.old_value}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </span>
  );
}
