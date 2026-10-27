import type { Mode } from "../../types/domain";
import { confirmationProblem } from "./ModeMoreOptions";
import { lineProblems, linePayload, lineValuesFrom, type LineValues } from "./modeLine";

/** A value that can be changed straight in the Modes table. */
export type InlineField =
  | "name"
  | "rfMin"
  | "rfMax"
  | "rfDelta"
  | "priMin"
  | "priMax"
  | "priDelta"
  | "jitter"
  | "stagger"
  | "frameTimeDelta"
  | "pwMin"
  | "pwMax"
  | "pwDelta"
  | "quality"
  | "quantity";

export const INLINE_LABEL: Record<InlineField, string> = {
  name: "Name",
  rfMin: "RF min (MHz)",
  rfMax: "RF max (MHz)",
  rfDelta: "RF ± delta (MHz)",
  priMin: "PRI min (µs)",
  priMax: "PRI max (µs)",
  priDelta: "PRI ± delta (µs)",
  jitter: "Jitter (µs), e.g. 0–1",
  stagger: "Stagger steps (µs), e.g. 800, 850, 900",
  frameTimeDelta: "Frame time ± delta (µs)",
  pwMin: "PW min (µs)",
  pwMax: "PW max (µs)",
  pwDelta: "PW ± delta (µs)",
  quality: "Confirmation quality (%)",
  quantity: "Confirmation quantity",
};

/** The line fields that are one box of the Mode form each. */
const LINE_KEY: Partial<Record<InlineField, keyof LineValues>> = {
  rfMin: "rfMin",
  rfMax: "rfMax",
  rfDelta: "rfDelta",
  priMin: "priMin",
  priMax: "priMax",
  priDelta: "priDelta",
  stagger: "stagger",
  frameTimeDelta: "frameTimeDelta",
  pwMin: "pwMin",
  pwMax: "pwMax",
  pwDelta: "pwDelta",
};

const str = (v: number | null | undefined) => (v == null ? "" : String(v));

/** The line as the form would hold it, but with every max written out — a
 * min changed on its own keeps its max rather than following it. */
function explicitLine(mode: Mode): LineValues {
  const line = mode.line;
  const v = lineValuesFrom(mode.pri_type, line);
  return line ? { ...v, rfMax: str(line.rf_max_mhz), priMax: str(line.pri_max_us), pwMax: str(line.pw_max_us) } : v;
}

/** What the box starts with: the programmed value, not the one shown with its margin. */
export function inlineText(mode: Mode, field: InlineField): string {
  if (field === "name") return mode.name;
  if (field === "quality") return String(mode.confirmation_quality);
  if (field === "quantity") return String(mode.confirmation_quantity);
  const v = explicitLine(mode);
  if (field === "jitter") return v.jitterMin === v.jitterMax ? v.jitterMin : `${v.jitterMin}–${v.jitterMax}`;
  return v[LINE_KEY[field]!] as string;
}

/** Which value a column's cell edits for this Mode, if any. A stagger's
 * steps sit in the PRI cell, its frame-time margin in PRI Δ. */
export function inlineFieldFor(column: string, mode: Mode, priMinShown: boolean): InlineField | null {
  const fixed = mode.pri_type === "fixed";
  const stagger = mode.pri_type === "stagger";
  if (column === "name") return "name";
  if (column === "confirmation_quality") return "quality";
  if (column === "confirmation_quantity") return "quantity";
  if (!mode.line) return null;
  switch (column) {
    case "rf_min":
      return "rfMin";
    case "rf_max":
      return "rfMax";
    case "rf_delta":
      return "rfDelta";
    case "pw_min":
      return "pwMin";
    case "pw_max":
      return "pwMax";
    case "pw_delta":
      return "pwDelta";
    case "pri_min":
      return fixed ? "priMin" : stagger ? "stagger" : null;
    case "pri_max":
      return fixed ? "priMax" : stagger && !priMinShown ? "stagger" : null;
    case "pri_delta":
      return fixed ? "priDelta" : stagger ? "frameTimeDelta" : null;
    case "jitter":
      return fixed ? "jitter" : null;
    default:
      return null;
  }
}

/** "0–1", "0 - 1", "0 to 1", or one value for both. */
function parseJitter(text: string): [string, string] {
  const parts = text.trim().split(/\s*(?:–|—|-|\bto\b)\s*/);
  return parts.length === 2 ? [parts[0], parts[1]] : [text.trim(), text.trim()];
}

export type InlineResult = { unchanged: true } | { problem: string } | { input: Record<string, unknown> };

/** The update a typed value makes, checked the way the Mode form checks it. */
export function inlineUpdate(mode: Mode, field: InlineField, text: string, siblings: Mode[]): InlineResult {
  const typed = text.trim();
  if (typed === inlineText(mode, field).trim()) return { unchanged: true };

  if (field === "name") {
    if (!typed) return { problem: "Give the Mode a name" };
    if (siblings.some((m) => m.id !== mode.id && m.ew_group_id === mode.ew_group_id && m.name === typed)) {
      return { problem: "Another Mode in this EW Group already has this name" };
    }
    return { input: { name: typed } };
  }
  if (field === "quality" || field === "quantity") {
    const quality = field === "quality" ? typed : String(mode.confirmation_quality);
    const quantity = field === "quantity" ? typed : String(mode.confirmation_quantity);
    const problem = confirmationProblem(quality, quantity);
    if (problem) return { problem };
    return { input: field === "quality" ? { confirmation_quality: Number(typed) } : { confirmation_quantity: Number(typed) } };
  }

  const v = explicitLine(mode);
  if (field === "jitter") [v.jitterMin, v.jitterMax] = parseJitter(typed);
  else (v[LINE_KEY[field]!] as string) = typed;
  // A blank margin is no margin, as in the form.
  if (field.endsWith("Delta") && typed === "") (v[LINE_KEY[field]!] as string) = "0";
  const explicitFrameTime = mode.pri_type === "stagger" ? (mode.line?.explicit_frame_time_us ?? null) : null;
  const problem = Object.values(lineProblems(v, explicitFrameTime))[0];
  if (problem) return { problem: problem.message };
  return { input: { line: linePayload(v, explicitFrameTime) } };
}
