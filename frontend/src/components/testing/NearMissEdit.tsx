import { useState } from "react";
import type { ObservedValues } from "../../api/testRecords";
import type { Mode, Source } from "../../types/domain";
import { describeMiss, matchEntry, shortMiss, TEST_CHECKS, type ParamMiss } from "../intercepts/interceptMatch";
import { ModeEditDialog } from "../modes/ModeDialogs";
import { useModeDefaults } from "../../state/hooks/useDwells";
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
  const stepDelta = useModeDefaults().defaults.stagger_step_delta_us;
  if (!mode) return null;
  const entries = nonEmptySets(sets)
    .map(asEntry)
    .filter((e) => e != null);
  const matches = entries.map((e) => matchEntry(e, [mode], { ...TEST_CHECKS, stepDelta }));
  if (matches.length === 0 || matches.some((m) => m.status === "match")) return null;
  const near = matches.flatMap((m) => m.near.filter((n) => n.mode.id === mode.id));
  if (near.length === 0) return null;
  const misses = near.flatMap((n) => n.misses);
  // One short line ("Close · PW 0.08–0.12 µs above, 2 sets · Edit…"), the full detail on hover.
  const short = summarizeMisses(misses);
  return (
    <div className="near-miss" title={misses.map(describeMiss).join("\n")}>
      <span className="status-badge status-pending_review">Close</span>
      <span className="hint-text"> {short} · </span>
      <button
        type="button"
        className="link-button"
        disabled={!canEdit}
        title={canEdit ? "Opens the Mode widened to cover what was logged; saved as derived from this test" : "Start editing this Emitter first"}
        aria-label={`Edit ${mode.name}`}
        onClick={() => setOpen(true)}
      >
        Edit…
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

/** The misses of several logged sets in a few words: the same value off in
 * the same direction once, as a range ("PW 0.08–0.12 µs above, 2 sets"). */
export function summarizeMisses(misses: ParamMiss[]): string {
  const groups = new Map<string, ParamMiss[]>();
  for (const m of misses) {
    const dir = m.positions || m.sequence ? "steps" : m.value > m.max ? "above" : "below";
    const key = `${m.label}|${dir}`;
    groups.set(key, [...(groups.get(key) ?? []), m]);
  }
  return [...groups.entries()]
    .map(([key, ms]) => {
      if (ms.length === 1 || key.endsWith("|steps")) return [...new Set(ms.map(shortMiss))].join("; ");
      const [label, dir] = key.split("|");
      const d = ms.map((m) => Number(Math.abs(dir === "above" ? m.value - m.max : m.min - m.value).toPrecision(3)));
      const lo = Math.min(...d);
      const hi = Math.max(...d);
      return `${label} ${lo === hi ? lo : `${lo}–${hi}`} ${ms[0].unit} ${dir}, ${ms.length} sets`;
    })
    .join("; ");
}
