import { useEffect, useRef, useState, type CSSProperties } from "react";
import { isoDayToText, parseDayText, parseTimeText } from "./dates";

/** What the field hands back — shaped like an input's change event, so a
 * handler written for a plain <input> keeps working. The value is ISO
 * ("2026-10-07"), or "" when the field is empty. */
type ValueEvent = { target: { value: string } };

interface CommonProps {
  value: string;
  onChange: (e: ValueEvent) => void;
  required?: boolean;
  disabled?: boolean;
  id?: string;
  name?: string;
  title?: string;
  className?: string;
  style?: CSSProperties;
  "aria-label"?: string;
  autoFocus?: boolean;
}

/** A date typed as day.month.year (07.10.2026 — also 7.10.26, 7/10/2026 or
 * 07102026), with a calendar button. Browsers show their own date fields in
 * the operating system's format, so this one is written out by hand. */
export function DateInput({ value, onChange, min, max, ...rest }: CommonProps & { min?: string; max?: string }) {
  const [text, setText] = useState(() => isoDayToText(value));
  const inputRef = useRef<HTMLInputElement>(null);
  const pickerRef = useRef<HTMLInputElement>(null);

  // Follow the value when it changes from outside (a reset, a loaded draft).
  useEffect(() => {
    setText((current) => (parseDayText(current) === value || (!value && !current.trim()) ? current : isoDayToText(value)));
  }, [value]);

  const parsed = parseDayText(text);
  const problem = !text.trim()
    ? null
    : !parsed
      ? "Write the date as dd.mm.yyyy"
      : min && parsed < min
        ? `On or after ${isoDayToText(min)}`
        : max && parsed > max
          ? `On or before ${isoDayToText(max)}`
          : null;
  useEffect(() => {
    inputRef.current?.setCustomValidity(problem ?? "");
  }, [problem]);

  function change(next: string) {
    setText(next);
    const iso = parseDayText(next);
    if (!next.trim()) onChange({ target: { value: "" } });
    else if (iso) onChange({ target: { value: iso } });
  }

  return (
    <span className="date-input" style={rest.style}>
      <input
        ref={inputRef}
        type="text"
        inputMode="numeric"
        placeholder="dd.mm.yyyy"
        className={rest.className}
        value={text}
        onChange={(e) => change(e.target.value)}
        onBlur={() => parsed && setText(isoDayToText(parsed))}
        required={rest.required}
        disabled={rest.disabled}
        id={rest.id}
        name={rest.name}
        title={problem ?? rest.title}
        aria-label={rest["aria-label"]}
        aria-invalid={problem ? true : undefined}
        autoFocus={rest.autoFocus}
      />
      <button
        type="button"
        className="date-input-picker"
        disabled={rest.disabled}
        tabIndex={-1}
        aria-label="Pick from a calendar"
        title="Pick from a calendar"
        onClick={() => {
          const picker = pickerRef.current;
          if (!picker) return;
          try {
            picker.showPicker();
          } catch {
            picker.focus();
          }
        }}
      >
        ▦
      </button>
      <input
        ref={pickerRef}
        type="date"
        className="date-input-native"
        tabIndex={-1}
        aria-hidden="true"
        value={parsed ?? value ?? ""}
        min={min}
        max={max}
        onChange={(e) => {
          setText(isoDayToText(e.target.value));
          onChange({ target: { value: e.target.value } });
        }}
      />
    </span>
  );
}

/** A time of day on the 24-hour clock, typed as hh:mm (14:05 — also 14.05 or
 * 1405). The value is "HH:MM", or "" when empty. */
export function TimeInput({ value, onChange, ...rest }: CommonProps) {
  const [text, setText] = useState(value ? value.slice(0, 5) : "");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setText((current) => (parseTimeText(current) === (value || null) || (!value && !current.trim()) ? current : value.slice(0, 5)));
  }, [value]);

  const parsed = parseTimeText(text);
  const problem = text.trim() && !parsed ? "Write the time as hh:mm (24-hour)" : null;
  useEffect(() => {
    inputRef.current?.setCustomValidity(problem ?? "");
  }, [problem]);

  return (
    <input
      ref={inputRef}
      type="text"
      inputMode="numeric"
      placeholder="hh:mm"
      className={rest.className ? `time-input ${rest.className}` : "time-input"}
      style={rest.style}
      value={text}
      onChange={(e) => {
        const next = e.target.value;
        setText(next);
        const t = parseTimeText(next);
        if (!next.trim()) onChange({ target: { value: "" } });
        else if (t) onChange({ target: { value: t } });
      }}
      onBlur={() => parsed && setText(parsed)}
      required={rest.required}
      disabled={rest.disabled}
      id={rest.id}
      name={rest.name}
      title={problem ?? rest.title}
      aria-label={rest["aria-label"]}
      aria-invalid={problem ? true : undefined}
      autoFocus={rest.autoFocus}
    />
  );
}
