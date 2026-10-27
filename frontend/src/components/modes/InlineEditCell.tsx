import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { Mode } from "../../types/domain";
import { ApiRequestError } from "../../api/client";
import { useEmitterModes, useUpdateMode } from "../../state/hooks/useModes";
import { friendlyServerError } from "./ModeLineFields";
import { INLINE_LABEL, inlineText, inlineUpdate, type InlineField } from "./inlineModeEdit";

/** Where to go once the value is saved: nowhere, or the row's next or
 * previous editable value (Tab / Shift+Tab). */
export type InlineMove = "close" | "next" | "prev";

/** One Mode value being changed in its table cell: Enter, Tab or clicking
 * away saves it, Escape puts it back. A value the Mode form wouldn't take
 * stays open with what's wrong under it. */
export function InlineEditCell({
  emitterId,
  mode,
  field,
  colSpan,
  programmedHint,
  onDone,
}: {
  emitterId: string;
  mode: Mode;
  field: InlineField;
  colSpan?: number;
  /** The table shows values with their margin; the box holds the programmed one. */
  programmedHint?: boolean;
  onDone: (move: InlineMove) => void;
}) {
  const [text, setText] = useState(() => inlineText(mode, field));
  const [problem, setProblem] = useState<string | null>(null);
  const updateMode = useUpdateMode(emitterId);
  const { data: emitterModes } = useEmitterModes(emitterId);
  const inputRef = useRef<HTMLInputElement>(null);
  // Enter and the blur that follows it are one save, not two.
  const saving = useRef(false);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  async function save(move: InlineMove) {
    if (saving.current) return;
    const result = inlineUpdate(mode, field, text, emitterModes ?? []);
    if ("unchanged" in result) return onDone(move);
    if ("problem" in result) {
      setProblem(result.problem);
      return;
    }
    saving.current = true;
    try {
      await updateMode.mutateAsync({ ewGroupId: mode.ew_group_id, modeId: mode.id, input: result.input });
      onDone(move);
    } catch (err) {
      setProblem(err instanceof ApiRequestError ? friendlyServerError(err.message) : "Couldn't save the Mode");
      saving.current = false;
      inputRef.current?.focus();
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      void save("close");
    } else if (e.key === "Tab") {
      e.preventDefault();
      void save(e.shiftKey ? "prev" : "next");
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      saving.current = true;
      onDone("close");
    }
  }

  const label = `${INLINE_LABEL[field]} — ${mode.name}`;
  return (
    <td colSpan={colSpan} className={`inline-editing inline-editing-${field}`}>
      <input
        ref={inputRef}
        value={text}
        aria-label={label}
        aria-invalid={!!problem || undefined}
        disabled={updateMode.isPending}
        title={
          programmedHint
            ? `${INLINE_LABEL[field]}: the programmed value (the table shows it with its delta). Enter saves, Esc cancels.`
            : `${INLINE_LABEL[field]}. Enter saves, Esc cancels.`
        }
        onChange={(e) => {
          setText(e.target.value);
          setProblem(null);
        }}
        onKeyDown={onKeyDown}
        onBlur={() => void save("close")}
      />
      {problem && (
        <span className="line-row-problem" role="alert">
          {problem}
        </span>
      )}
    </td>
  );
}
