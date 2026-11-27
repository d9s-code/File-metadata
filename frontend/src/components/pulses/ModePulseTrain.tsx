/** A Mode's pulse train, drawn as its form is typed: its PRI (a Fixed one at
 * its middle, with the spread its range and jitter allow shaded; a
 * stagger's steps in order), its PW, and its pulse groups. */
import type { ModeLineFields, PriType } from "../../types/domain";
import { modeTrain } from "./pulseTrain";
import { PulseTrainChart, timeText } from "./PulseTrainChart";

export function ModePulseTrain({
  priType,
  line,
  groupPulses,
  groupOffMs,
}: {
  priType: PriType;
  line: Partial<ModeLineFields> | null;
  groupPulses?: number | null;
  groupOffMs?: number | null;
}) {
  if (!line || (priType !== "fixed" && priType !== "stagger")) return null;
  let steps: number[] = [];
  let spread = 0;
  if (priType === "fixed" && line.pri_min_us != null) {
    const lo = line.pri_min_us;
    const hi = line.pri_max_us ?? lo;
    steps = [(lo + hi) / 2];
    spread = (hi - lo) / 2 + (line.jitter_max_us ?? 0);
  } else if (priType === "stagger") steps = line.pri_stagger_values_us ?? [];
  const train = modeTrain(steps, groupPulses, groupOffMs);
  if (!train) return null;
  const pw = line.pw_max_us ?? line.pw_min_us ?? null;
  const caption = [
    priType === "fixed" ? `PRI ${timeText(steps[0])}${spread > 0 ? ` ± ${timeText(spread)} (shaded)` : ""}` : `Stagger of ${steps.length}, frame ${timeText(steps.reduce((a, b) => a + b, 0))}`,
    pw ? `PW ${timeText(pw)}` : null,
    groupPulses && groupOffMs != null ? `groups of ${groupPulses}, off ${timeText(groupOffMs * 1000)} — repeats every ${timeText(train.periodUs)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className="mode-pulse-train">
      <PulseTrainChart train={train} pwUs={pw} spreadUs={spread} caption={caption} label="The Mode's pulse train" />
    </div>
  );
}
