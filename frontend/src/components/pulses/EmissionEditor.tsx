/** An operational mode's emission, edited: its timeline — pulse groups (one
 * of the Emitter's Modes for N pulses or a time) and off times, in order,
 * repeated — and its on/off periods, with the timeline drawn as it's typed. */
import type { Emission, EmissionItem } from "../../api/operationalModes";
import type { Mode } from "../../types/domain";
import { timelineTrain, type TimelineStep } from "./pulseTrain";
import { PulseTrainChart, timeText } from "./PulseTrainChart";

export interface StepDraft {
  kind: "group" | "off";
  modeId: string;
  /** "pulses" or "ms" — what `amount` counts (an off time: ms). */
  unit: "pulses" | "ms";
  amount: string;
}

export interface EmissionDraft {
  steps: StepDraft[];
  onS: string;
  offS: string;
}

export function emissionDraftFrom(e: Emission | null | undefined): EmissionDraft {
  return {
    steps: (e?.timeline ?? []).map((i) => ({
      kind: i.kind,
      modeId: i.mode_id ?? "",
      unit: i.kind === "group" && i.pulses != null ? "pulses" : "ms",
      amount: String(i.pulses ?? i.ms ?? ""),
    })),
    onS: e?.on_s != null ? String(e.on_s) : "",
    offS: e?.off_s != null ? String(e.off_s) : "",
  };
}

export function emissionProblem(d: EmissionDraft): string | null {
  for (const [i, s] of d.steps.entries()) {
    const n = Number(s.amount);
    if (s.kind === "group" && !s.modeId) return `Step ${i + 1}: pick its Mode`;
    if (!s.amount.trim() || !(n > 0)) return `Step ${i + 1}: a number above 0`;
    if (s.kind === "group" && s.unit === "pulses" && !Number.isInteger(n)) return `Step ${i + 1}: a whole number of pulses`;
  }
  if (d.steps.length && !d.steps.some((s) => s.kind === "group")) return "The timeline needs at least one pulse group";
  const on = d.onS.trim();
  const off = d.offS.trim();
  if (!!on !== !!off) return "On/off periods need both the time on and the time off, or neither";
  if (on && (!(Number(on) > 0) || !(Number(off) >= 0))) return "On is a number of seconds above 0, off 0 or more";
  return null;
}

export function emissionPayload(d: EmissionDraft): Emission | null {
  const timeline: EmissionItem[] = d.steps.map((s) =>
    s.kind === "off"
      ? { kind: "off", ms: Number(s.amount) }
      : { kind: "group", mode_id: s.modeId, ...(s.unit === "pulses" ? { pulses: Number(s.amount) } : { ms: Number(s.amount) }) },
  );
  const onOff = d.onS.trim() && d.offS.trim() ? { on_s: Number(d.onS), off_s: Number(d.offS) } : {};
  return timeline.length || "on_s" in onOff ? { ...(timeline.length ? { timeline } : {}), ...onOff } : null;
}

/** A Mode's gaps between pulses, µs, as drawn: a Fixed PRI's middle, a stagger's steps. */
export function modeSteps(m: Mode | undefined): number[] {
  const l = m?.line;
  if (!m || !l) return [];
  if (m.pri_type === "fixed" && l.pri_min_us != null) return [(l.pri_min_us + (l.pri_max_us ?? l.pri_min_us)) / 2];
  if (m.pri_type === "stagger") return l.pri_stagger_values_us ?? [];
  return [];
}

/** The draft as a timeline the pulse train draws. */
export function draftSteps(d: EmissionDraft, modes: Mode[]): TimelineStep[] {
  const byId = new Map(modes.map((m) => [m.id, m]));
  return d.steps.flatMap((s): TimelineStep[] => {
    const n = Number(s.amount);
    if (!(n > 0)) return [];
    if (s.kind === "off") return [{ kind: "off", ms: n }];
    const m = byId.get(s.modeId);
    if (!m) return [];
    return [{ kind: "group", mode_name: m.name, pulses: s.unit === "pulses" ? n : null, ms: s.unit === "ms" ? n : null, steps_us: modeSteps(m) }];
  });
}

export function EmissionEditor({
  draft,
  onChange,
  modes,
  preferred,
  inheritedOnOff,
}: {
  draft: EmissionDraft;
  onChange: (d: EmissionDraft) => void;
  /** The Emitter's Modes. */
  modes: Mode[];
  /** The Modes under this operational mode — listed first. */
  preferred: Set<string>;
  /** The on/off periods it takes when it has none: [on, off] s and from where. */
  inheritedOnOff?: { onS: number; offS: number; from: string } | null;
}) {
  const set = (i: number, part: Partial<StepDraft>) => onChange({ ...draft, steps: draft.steps.map((s, j) => (j === i ? { ...s, ...part } : s)) });
  const move = (i: number, by: number) => {
    const steps = [...draft.steps];
    const [s] = steps.splice(i, 1);
    steps.splice(i + by, 0, s);
    onChange({ ...draft, steps });
  };
  const sorted = [...modes].sort(
    (a, b) => Number(preferred.has(b.id)) - Number(preferred.has(a.id)) || a.name.localeCompare(b.name, undefined, { numeric: true }),
  );
  const train = timelineTrain(draftSteps(draft, modes));
  const unpulsed = draft.steps.some((s) => s.kind === "group" && s.modeId && !modeSteps(modes.find((m) => m.id === s.modeId)).length);

  return (
    <fieldset className="mode-scan-box">
      <legend>Emission — what it transmits over time</legend>
      <p className="hint-text">
        A <strong>timeline</strong> of pulse groups (one of the Modes for a number of pulses, or for a time) and off times, repeated —
        for bursts, a set of PRFs in turn, dwell &amp; switch. Empty: its Modes as they are. <strong>On/off periods</strong> switch the
        whole of it on and off (the ones under it take them). For the dwell planner; not exported.
      </p>
      {draft.steps.length > 0 && (
        <table className="emission-steps">
          <tbody>
            {draft.steps.map((s, i) => (
              <tr key={i}>
                <td style={{ width: "2rem" }} className="hint-text">
                  {i + 1}
                </td>
                <td style={{ width: "40%" }}>
                  {s.kind === "group" ? (
                    <select value={s.modeId} aria-label={`Step ${i + 1} Mode`} onChange={(e) => set(i, { modeId: e.target.value })}>
                      <option value="">— Mode —</option>
                      {sorted.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span>Off</span>
                  )}
                </td>
                <td style={{ width: "22%" }}>
                  <input
                    type="number"
                    min="0"
                    step={s.kind === "group" && s.unit === "pulses" ? 1 : "any"}
                    value={s.amount}
                    aria-label={`Step ${i + 1} ${s.kind === "off" ? "ms" : s.unit}`}
                    onChange={(e) => set(i, { amount: e.target.value })}
                  />
                </td>
                <td style={{ width: "18%" }}>
                  {s.kind === "group" ? (
                    <select value={s.unit} aria-label={`Step ${i + 1} unit`} onChange={(e) => set(i, { unit: e.target.value as StepDraft["unit"] })}>
                      <option value="pulses">pulses</option>
                      <option value="ms">ms</option>
                    </select>
                  ) : (
                    <span className="hint-text">ms</span>
                  )}
                </td>
                <td className="row-actions" style={{ whiteSpace: "nowrap" }}>
                  <button type="button" className="link-button" disabled={i === 0} aria-label={`Move step ${i + 1} up`} onClick={() => move(i, -1)}>
                    ↑
                  </button>{" "}
                  <button
                    type="button"
                    className="link-button"
                    disabled={i === draft.steps.length - 1}
                    aria-label={`Move step ${i + 1} down`}
                    onClick={() => move(i, 1)}
                  >
                    ↓
                  </button>{" "}
                  <button
                    type="button"
                    className="link-button"
                    aria-label={`Remove step ${i + 1}`}
                    onClick={() => onChange({ ...draft, steps: draft.steps.filter((_, j) => j !== i) })}
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="op-gen-actions">
        <button
          type="button"
          className="link-button"
          onClick={() => onChange({ ...draft, steps: [...draft.steps, { kind: "group", modeId: "", unit: "pulses", amount: "" }] })}
        >
          + Pulse group
        </button>
        <button type="button" className="link-button" onClick={() => onChange({ ...draft, steps: [...draft.steps, { kind: "off", modeId: "", unit: "ms", amount: "" }] })}>
          + Off time
        </button>
      </div>
      {train && (
        <PulseTrainChart
          train={train}
          label="The operational mode's timeline"
          caption={`Repeats every ${timeText(train.periodUs)} · ${Math.round((1 - offShare(train)) * 100)}% of it transmitting${unpulsed ? " · a CW Mode's group is drawn empty" : ""}`}
        />
      )}
      <div className="mode-form-grid">
        <label>
          On (s)
          <input
            type="number"
            step="any"
            min="0"
            value={draft.onS}
            placeholder={inheritedOnOff ? `${inheritedOnOff.onS} — from ${inheritedOnOff.from}` : "Empty: always on"}
            onChange={(e) => onChange({ ...draft, onS: e.target.value })}
          />
        </label>
        <label>
          Then off (s)
          <input
            type="number"
            step="any"
            min="0"
            value={draft.offS}
            placeholder={inheritedOnOff ? `${inheritedOnOff.offS} — from ${inheritedOnOff.from}` : undefined}
            onChange={(e) => onChange({ ...draft, offS: e.target.value })}
          />
        </label>
      </div>
    </fieldset>
  );
}

/** The share of a timeline that's off. */
function offShare(train: ReturnType<typeof timelineTrain> & object): number {
  const off = train.segments.filter((s) => s.kind === "off").reduce((n, s) => n + s.end - s.start, 0);
  return train.periodUs > 0 ? off / train.periodUs : 0;
}

