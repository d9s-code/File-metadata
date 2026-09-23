import { useCallback, useState } from "react";
import { FRAME_TIME_DECIMALS, frameTimeFromText } from "../common/frameTime";

function cut(n: number): number {
  const factor = 10 ** FRAME_TIME_DECIMALS;
  return Math.round(n * factor) / factor;
}

/** State for a stagger Mode's frame time: follows the sum of the typed
 * sequence until the user writes their own value, then keeps that value. */
export function useFrameTimeField(staggerText: string, initialExplicit?: number | null) {
  const [text, setText] = useState(initialExplicit != null ? String(initialExplicit) : "");
  const [edited, setEdited] = useState(initialExplicit != null);
  const sum = frameTimeFromText(staggerText);
  // Stable, so forms can call it from effects.
  const load = useCallback((explicit: number | null | undefined) => {
    setText(explicit != null ? String(explicit) : "");
    setEdited(explicit != null);
  }, []);

  return {
    sum,
    edited,
    value: edited ? text : sum > 0 ? String(sum) : "",
    onChange(raw: string) {
      setText(raw);
      setEdited(true);
    },
    /** Back to following the sum. */
    reset() {
      setText("");
      setEdited(false);
    },
    /** Loads a known value, e.g. from a duplicated Mode or an observed set;
     * null goes back to the sum. */
    load,
    /** What to send as explicit_frame_time_us: null unless a value was
     * written in that differs from the sum. */
    payload(): number | null {
      if (!edited || text.trim() === "") return null;
      const n = cut(Number(text));
      return Number.isFinite(n) && n !== sum ? n : null;
    },
  };
}

export type FrameTimeField = ReturnType<typeof useFrameTimeField>;

export function FrameTimeInput({ field }: { field: FrameTimeField }) {
  const overridden = field.payload() != null;
  return (
    <>
      <label>
        frame time (µs)
        <input
          type="number"
          step="any"
          min="0"
          value={field.value}
          onChange={(e) => field.onChange(e.target.value)}
          placeholder="sum of sequence"
          title="Defaults to the sum of the stagger sequence. Write a value to use it instead (cut to 3 decimals)."
        />
      </label>
      <span className="hint-text">
        {overridden ? (
          <>
            Written in (sum is {field.sum} µs){" "}
            <button type="button" className="link-button" onClick={field.reset}>
              Use sum
            </button>
          </>
        ) : (
          "Sum of the sequence"
        )}
      </span>
    </>
  );
}
