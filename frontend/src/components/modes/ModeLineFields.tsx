import { useCallback, useMemo, useState, type ReactNode } from "react";
import type { PriType } from "../../types/domain";
import { FrameTimeInput, useFrameTimeField } from "./FrameTimeInput";
import {
  lineProblems,
  linePayload,
  parseStagger,
  rangePreview,
  staggerPreview,
  type LineBox,
  type LineRow,
  type LineValues,
} from "./modeLine";

const PRI_TYPE_LABELS: Record<PriType, string> = { fixed: "Fixed", stagger: "Stagger", cw: "CW", xlet: "X-let" };

/** A Mode line being typed: its values, the frame time, what's wrong with it
 * and — so messages don't jump at you mid-typing — which of those to show:
 * a row's problem shows once you've left that row, or everywhere after a
 * submit attempt. */
export function useModeLine(initial: LineValues, initialExplicitFrameTime?: number | null) {
  const [values, setValues] = useState(initial);
  const normalizedStagger = useMemo(() => parseStagger(values.stagger).values.join(", "), [values.stagger]);
  const frameTime = useFrameTimeField(normalizedStagger, initialExplicitFrameTime);
  const [touched, setTouched] = useState<Set<LineRow>>(new Set());
  const [focused, setFocused] = useState<LineRow | null>(null);
  const [revealed, setRevealed] = useState(false);
  const explicit = values.priType === "stagger" ? frameTime.payload() : null;
  const problems = useMemo(() => lineProblems(values, explicit), [values, explicit]);
  const { load: loadFrameTime } = frameTime;

  const set = useCallback(<K extends keyof LineValues>(key: K, value: LineValues[K]) => {
    setValues((prev) => ({ ...prev, [key]: value }));
  }, []);
  const setMany = useCallback((part: Partial<LineValues>) => setValues((prev) => ({ ...prev, ...part })), []);
  /** Replace everything — duplicating a Mode, starting the next one. */
  const load = useCallback(
    (next: LineValues, explicitFrameTime?: number | null) => {
      setValues(next);
      loadFrameTime(explicitFrameTime ?? null);
      setTouched(new Set());
      setRevealed(false);
    },
    [loadFrameTime],
  );

  return {
    values,
    frameTime,
    problems,
    valid: Object.keys(problems).length === 0,
    set,
    setMany,
    load,
    loadFrameTime,
    focus: (row: LineRow) => setFocused(row),
    blur: (row: LineRow) => {
      setFocused((f) => (f === row ? null : f));
      setTouched((t) => (t.has(row) ? t : new Set(t).add(row)));
    },
    shown: (row: LineRow) => ((revealed || (touched.has(row) && focused !== row)) ? problems[row] : undefined),
    /** Whether this box is the one to outline. */
    wrong: (row: LineRow, box: LineBox) => {
      const p = (revealed || (touched.has(row) && focused !== row)) ? problems[row] : undefined;
      return p?.box === box;
    },
    /** After a submit attempt: show every problem. */
    reveal: () => setRevealed(true),
    payload: () => linePayload(values, explicit),
  };
}

export type ModeLineState = ReturnType<typeof useModeLine>;

function Field({
  label,
  hint,
  children,
  wide = false,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <label className={wide ? "line-field wide" : "line-field"} title={hint}>
      <span className="line-field-label">{label}</span>
      {children}
    </label>
  );
}

function NumberInput({
  value,
  onChange,
  aria,
  placeholder,
  invalid,
  min,
}: {
  value: string;
  onChange: (v: string) => void;
  aria: string;
  placeholder?: string;
  invalid?: boolean;
  min?: number;
}) {
  return (
    <input
      type="number"
      step="any"
      inputMode="decimal"
      min={min}
      value={value}
      placeholder={placeholder}
      aria-label={aria}
      aria-invalid={invalid || undefined}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function RangeCheck({ checked, onChange, param }: { checked: boolean; onChange: (v: boolean) => void; param: string }) {
  return (
    <label className="line-range-check" title={`Match ${param} as a range (stored with the Mode; shown in the Range Matching column)`}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      Range
    </label>
  );
}

/** One parameter: its name and unit, its inputs, then what it will match and
 * any problem, each on its own line under the inputs. */
function Row({
  row,
  name,
  unit,
  line,
  children,
  preview,
}: {
  row: LineRow;
  name: ReactNode;
  unit?: string;
  line: ModeLineState;
  children: ReactNode;
  preview?: string | null;
}) {
  const problem = line.shown(row);
  return (
    <div
      className={problem ? "line-row has-problem" : "line-row"}
      onFocus={() => line.focus(row)}
      // Moving between this row's own inputs isn't leaving it.
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) line.blur(row);
      }}
    >
      <div className="line-row-name">
        <strong>{name}</strong>
        {unit && <span className="hint-text">{unit}</span>}
      </div>
      <div className="line-row-body">
        <div className="line-row-inputs">{children}</div>
        {problem ? (
          <p className="line-row-problem" role="alert">
            {problem.message}
          </p>
        ) : (
          preview && <p className="line-row-preview">{preview}</p>
        )}
      </div>
    </div>
  );
}

/** RF, PRI (with its type) and PW for a Mode's line — the same fields in the
 * Add and Edit forms. A blank max means the same as min, for a single value. */
export function ModeLineFields({ line }: { line: ModeLineState }) {
  const v = line.values;
  const maxHint = "Leave blank for a single value — max is then the same as min";

  return (
    <div className="mode-line-fields">
      <Row row="rf" name="RF" unit="MHz" line={line} preview={rangePreview(v.rfMin, v.rfMax, v.rfDelta, "MHz")}>
        <Field label="min">
          <NumberInput value={v.rfMin} onChange={(x) => line.set("rfMin", x)} aria="RF min (MHz)" invalid={line.wrong("rf", "min")} />
        </Field>
        <Field label="max" hint={maxHint}>
          <NumberInput value={v.rfMax} onChange={(x) => line.set("rfMax", x)} aria="RF max (MHz)" placeholder="= min" invalid={line.wrong("rf", "max")} />
        </Field>
        <Field label="± margin" hint="Widens min and max by this much each way">
          <NumberInput value={v.rfDelta} onChange={(x) => line.set("rfDelta", x)} aria="RF margin (MHz)" min={0} invalid={line.wrong("rf", "delta")} />
        </Field>
        <RangeCheck checked={v.rfRange} onChange={(x) => line.set("rfRange", x)} param="RF" />
      </Row>

      <Row
        row={v.priType === "stagger" ? "stagger" : "pri"}
        name={
          <>
            PRI{" "}
            <select
              className="line-pri-type"
              aria-label="PRI type"
              value={v.priType}
              onChange={(e) => line.set("priType", e.target.value as PriType)}
            >
              {(Object.keys(PRI_TYPE_LABELS) as PriType[]).map((t) => (
                <option key={t} value={t}>
                  {PRI_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </>
        }
        unit={v.priType === "fixed" || v.priType === "stagger" ? "µs" : undefined}
        line={line}
        preview={
          v.priType === "fixed"
            ? rangePreview(v.priMin, v.priMax, v.priDelta, "µs")
            : v.priType === "stagger"
              ? staggerPreview(v.stagger, Number(line.frameTime.value) || line.frameTime.sum, v.frameTimeDelta)
              : null
        }
      >
        {v.priType === "fixed" && (
          <>
            <Field label="min">
              <NumberInput value={v.priMin} onChange={(x) => line.set("priMin", x)} aria="PRI min (µs)" invalid={line.wrong("pri", "min")} />
            </Field>
            <Field label="max" hint={maxHint}>
              <NumberInput value={v.priMax} onChange={(x) => line.set("priMax", x)} aria="PRI max (µs)" placeholder="= min" invalid={line.wrong("pri", "max")} />
            </Field>
            <Field label="± margin" hint="Widens min and max by this much each way">
              <NumberInput value={v.priDelta} onChange={(x) => line.set("priDelta", x)} aria="PRI margin (µs)" min={0} invalid={line.wrong("pri", "delta")} />
            </Field>
            <RangeCheck checked={v.priRange} onChange={(x) => line.set("priRange", x)} param="PRI" />
          </>
        )}
        {v.priType === "stagger" && (
          <>
            <Field label="sequence, in order" hint="Steps in µs, separated by commas or spaces" wide>
              <input
                value={v.stagger}
                placeholder="800, 850, 900, 780"
                aria-label="Stagger sequence (µs)"
                aria-invalid={line.wrong("stagger", "sequence") || undefined}
                onChange={(e) => line.set("stagger", e.target.value)}
              />
            </Field>
            <FrameTimeInput field={line.frameTime} />
            <Field label="± frame margin" hint="Widens the frame time by this much each way">
              <NumberInput
                value={v.frameTimeDelta}
                onChange={(x) => line.set("frameTimeDelta", x)}
                aria="Frame time margin (µs)"
                min={0}
                invalid={line.wrong("stagger", "delta")}
              />
            </Field>
            <RangeCheck checked={v.priRange} onChange={(x) => line.set("priRange", x)} param="PRI" />
          </>
        )}
        {v.priType === "cw" && <span className="hint-text">CW has no PRI — nothing to enter.</span>}
        {v.priType === "xlet" && <span className="hint-text">X-let has no fields yet.</span>}
      </Row>

      {v.priType === "fixed" && (
        <Row row="jitter" name="Jitter" unit="µs" line={line}>
          <Field label="min">
            <NumberInput value={v.jitterMin} onChange={(x) => line.set("jitterMin", x)} aria="Jitter min (µs)" min={0} invalid={line.wrong("jitter", "min")} />
          </Field>
          <Field label="max">
            <NumberInput value={v.jitterMax} onChange={(x) => line.set("jitterMax", x)} aria="Jitter max (µs)" min={0} invalid={line.wrong("jitter", "max")} />
          </Field>
        </Row>
      )}

      <Row row="pw" name="PW" unit="µs" line={line} preview={rangePreview(v.pwMin, v.pwMax, v.pwDelta, "µs")}>
        <Field label="min">
          <NumberInput value={v.pwMin} onChange={(x) => line.set("pwMin", x)} aria="PW min (µs)" invalid={line.wrong("pw", "min")} />
        </Field>
        <Field label="max" hint={maxHint}>
          <NumberInput value={v.pwMax} onChange={(x) => line.set("pwMax", x)} aria="PW max (µs)" placeholder="= min" invalid={line.wrong("pw", "max")} />
        </Field>
        <Field label="± margin" hint="Widens min and max by this much each way">
          <NumberInput value={v.pwDelta} onChange={(x) => line.set("pwDelta", x)} aria="PW margin (µs)" min={0} invalid={line.wrong("pw", "delta")} />
        </Field>
        <RangeCheck checked={v.pwRange} onChange={(x) => line.set("pwRange", x)} param="PW" />
      </Row>
    </div>
  );
}

/** A server message in people's words: "rf_min_mhz must be <= rf_max_mhz" →
 * "RF min must be ≤ RF max". */
export function friendlyServerError(message: string): string {
  const names: [RegExp, string][] = [
    [/rf_min_mhz/g, "RF min"],
    [/rf_max_mhz/g, "RF max"],
    [/pw_min_us/g, "PW min"],
    [/pw_max_us/g, "PW max"],
    [/pri_min_us/g, "PRI min"],
    [/pri_max_us/g, "PRI max"],
    [/jitter_min_us/g, "jitter min"],
    [/jitter_max_us/g, "jitter max"],
    [/pri_stagger_values_us/g, "stagger sequence"],
    [/explicit_frame_time_us/g, "frame time"],
    [/frame_time_delta_us/g, "frame time margin"],
    [/rf_delta|pw_delta|pri_delta/g, "margin"],
  ];
  let out = message.replace(/Value error,\s*/g, "");
  for (const [re, label] of names) out = out.replace(re, label);
  return out.replace(/<=/g, "≤").replace(/>=/g, "≥");
}
