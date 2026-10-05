import { useRef, useState, type FormEvent } from "react";
import { useUpdateMode } from "../../state/hooks/useModes";
import { ApiRequestError } from "../../api/client";
import type { FunctionGroup, Mode, Source } from "../../types/domain";
import { lineValuesFrom } from "./modeLine";
import { ModeLineFields, friendlyServerError, useModeLine } from "./ModeLineFields";
import { ModeMoreOptions, confirmationProblem, type MoreOptionsValues } from "./ModeMoreOptions";

/** Edits an existing Mode's line in place, including its PRI type — changing
 * type always submits a full new line for it (the old type's fields, e.g.
 * Fixed's jitter, are meaningless under a new one), same as the backend
 * requires. The same fields as adding a Mode. */
export function ModeEditForm({
  emitterId,
  mode,
  functionGroups,
  sources,
  onDone,
}: {
  emitterId: string;
  mode: Mode;
  functionGroups?: FunctionGroup[];
  sources?: Source[];
  onDone: () => void;
}) {
  const updateMode = useUpdateMode(emitterId);
  const line = useModeLine(lineValuesFrom(mode.pri_type, mode.line), mode.line?.explicit_frame_time_us);
  const [sourceId, setSourceId] = useState(mode.source_id);
  const [options, setOptions] = useState<MoreOptionsValues>({
    functionGroupId: mode.function_group_id ?? "",
    quality: String(mode.confirmation_quality),
    quantity: String(mode.confirmation_quantity),
    notes: mode.notes ?? "",
    derivedFrom: new Set(),
  });
  const [optionsForced, setOptionsForced] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    line.reveal();
    const optionsProblem = confirmationProblem(options.quality, options.quantity);
    setOptionsForced(!!optionsProblem);
    if (!line.valid || optionsProblem) {
      setTimeout(() => formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(), 0);
      return;
    }
    const priType = line.values.priType;
    try {
      await updateMode.mutateAsync({
        ewGroupId: mode.ew_group_id,
        modeId: mode.id,
        input: {
          notes: options.notes.trim() || null,
          source_id: sourceId !== mode.source_id ? sourceId : undefined,
          function_group_id: options.functionGroupId || null,
          pri_type: priType !== mode.pri_type ? priType : undefined,
          confirmation_quality: Number(options.quality),
          confirmation_quantity: Number(options.quantity),
          line: line.payload(),
          derived_from_test_record_ids: [...options.derivedFrom],
        },
      });
      onDone();
    } catch (err) {
      setError(err instanceof ApiRequestError ? friendlyServerError(err.message) : "Couldn't save the Mode");
    }
  }

  return (
    <form className="card mode-form mode-edit-form" onSubmit={handleSubmit} noValidate ref={formRef}>
      <div className="mode-form-head">
        <h4>Editing {mode.name}</h4>
        <span className="hint-text">Takes effect as soon as you save.</span>
      </div>

      {sources && sources.length > 0 && (
        <div className="mode-form-grid">
          <label>
            Source
            <select value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
              {sources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      <ModeLineFields line={line} />

      <ModeMoreOptions
        values={options}
        onChange={(part) => setOptions((o) => ({ ...o, ...part }))}
        functionGroups={functionGroups}
        emitterId={emitterId}
        showDerived
        forceOpen={optionsForced}
      />

      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      <div className="mode-form-actions">
        <button type="submit" disabled={updateMode.isPending}>
          {updateMode.isPending ? "Saving…" : "Save"}
        </button>
        <button type="button" className="button secondary" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}
