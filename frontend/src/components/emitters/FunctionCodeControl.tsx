import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ApiRequestError } from "../../api/client";
import { emittersApi } from "../../api/emitters";
import { functionCodeLabel } from "../../api/functionCodes";
import { useHasRole } from "../../auth/RequireAuth";
import { emittersKey } from "../../state/hooks/useEmitters";
import { useFunctionCodes } from "../../state/hooks/useFunctionCodes";
import type { Emitter } from "../../types/domain";
import { MenuButton } from "../common/MenuButton";

/** What kind of emitter it is, as a chip ("FC ▾") that opens the Admins'
 * function codes to pick from. Like the assignee, not part of its saved
 * versions, so it can be changed without editing the Emitter. */
export function FunctionCodeControl({ emitter }: { emitter: Emitter }) {
  const qc = useQueryClient();
  const canChange = useHasRole("editor") && !emitter.is_deleted;
  const { data: codes } = useFunctionCodes();
  const set = useMutation({
    mutationFn: (codeId: string | null) => emittersApi.setFunctionCode(emitter.id, codeId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: emittersKey });
      qc.invalidateQueries({ queryKey: ["threat-priorities"] });
      qc.invalidateQueries({ queryKey: ["function-codes"] });
    },
  });
  const current = (codes ?? []).find((c) => c.id === emitter.function_code_id);
  const text = current ? current.code : "No function code";
  const title = current ? `Function code: ${functionCodeLabel(current)}` : "What kind of emitter it is — not set yet";
  const chipClass = current ? "meta-chip" : "meta-chip none";

  if (!canChange) {
    return (
      <span className={chipClass} title={title}>
        {text}
      </span>
    );
  }
  const mark = (id: string | null) => (id === (emitter.function_code_id ?? null) ? "✓ " : "");
  return (
    <>
      <MenuButton
        align="start"
        className={chipClass}
        title={`${title} — click to change; needs no edit lock`}
        ariaLabel={`Function code ${current ? current.code : "not set"} — change`}
        disabled={set.isPending}
        label={
          <>
            {text} <span className="chip-caret">▾</span>
          </>
        }
        items={[
          ...(codes ?? []).map((c) => ({ label: `${mark(c.id)}${functionCodeLabel(c)}`, onSelect: () => set.mutate(c.id) })),
          ...(emitter.function_code_id ? [{ label: "None", onSelect: () => set.mutate(null) }] : []),
          ...((codes ?? []).length === 0 ? [{ label: "No function codes yet — an Admin adds them", disabled: true, onSelect: () => {} }] : []),
        ]}
      />
      {set.error && (
        <span className="error-text">{set.error instanceof ApiRequestError ? set.error.message : "Couldn't change it"}</span>
      )}
    </>
  );
}
