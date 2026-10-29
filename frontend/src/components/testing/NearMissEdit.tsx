import { useState } from "react";
import type { ObservedValues } from "../../api/testRecords";
import type { Mode, Source } from "../../types/domain";
import { describeMiss, matchEntry } from "../intercepts/interceptMatch";
import { ModeEditDialog } from "../modes/ModeDialogs";
import { widened } from "./nearMiss";
import { asEntry } from "./signalCoverage";
import { nonEmptySets } from "./testFormat";

/** Under a missed result: when what was logged misses this Mode on just one
 * value, says so and offers editing the Mode — opened widened to cover it,
 * and saved as derived from the run. Nothing when it matches or is further off. */
export function NearMissEdit({
  emitterId,
  mode,
  sets,
  sources,
  run,
  canEdit,
}: {
  emitterId: string;
  mode: Mode | undefined;
  sets: ObservedValues[] | null | undefined;
  sources: Source[];
  run: { id: string; title: string };
  canEdit: boolean;
}) {
  const [open, setOpen] = useState(false);
  if (!mode) return null;
  const entries = nonEmptySets(sets)
    .map(asEntry)
    .filter((e) => e != null);
  const matches = entries.map((e) => matchEntry(e, [mode]));
  if (matches.length === 0 || matches.some((m) => m.status === "match")) return null;
  const near = matches.flatMap((m) => m.near.filter((n) => n.mode.id === mode.id));
  if (near.length === 0) return null;
  const misses = near.flatMap((n) => n.misses);
  return (
    <div className="near-miss">
      <span className="status-badge status-pending_review">Close</span>{" "}
      <span className="hint-text">{misses.map(describeMiss).join("; ")}</span>{" "}
      <button
        type="button"
        className="link-button"
        disabled={!canEdit}
        title={canEdit ? "Opens the Mode widened to cover what was logged; saved as derived from this test" : "Start editing this Emitter first"}
        onClick={() => setOpen(true)}
      >
        Edit {mode.name}…
      </button>
      {open && (
        <ModeEditDialog
          emitterId={emitterId}
          mode={mode}
          sources={sources}
          lineChange={widened(mode, misses)}
          derivedFromTestRecord={run}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}
