import { useState } from "react";
import type { ParameterSequence } from "../../types/domain";
import {
  useParameterSequences,
  useDeleteParameterSequence,
  useDeleteParameterSequenceStep,
  useUpdateParameterSequence,
} from "../../state/hooks/useParameterSequences";
import { useConfirmDialog } from "../common/ConfirmDialog";
import { useEmitter } from "../../state/hooks/useEmitters";
import { useEmitterCheckoutState } from "../../state/hooks/useEmitterCheckout";
import { sequenceRangeSummary, stepHas, stepValueText, type StepParam } from "./sequenceStep";
import { SequenceForm } from "./SequenceForm";
import { SequenceKindControl } from "./SequenceKind";
import { useHasRole } from "../../auth/RequireAuth";


const STEP_COLUMNS: { param: StepParam; label: string }[] = [
  { param: "rf", label: "RF (MHz)" },
  { param: "pri", label: "PRI (µs)" },
  { param: "pw", label: "PW (µs)" },
];

/** A sequence with no step touching rf_mhz/pw_us — delta override doesn't
 * apply to it (every value it can contribute is a PRI point value). */
function isPriOnlySequence(seq: ParameterSequence): boolean {
  return seq.steps.every((s) => !stepHas(s, "rf") && !stepHas(s, "pw"));
}

function SequenceDeltaEditor({
  emitterId,
  sourceId,
  sequence,
  canEdit,
}: {
  emitterId: string;
  sourceId: string;
  sequence: ParameterSequence;
  canEdit: boolean;
}) {
  const updateSequence = useUpdateParameterSequence(emitterId, sourceId);
  const [rfDelta, setRfDelta] = useState(sequence.rf_delta?.toString() ?? "");
  const [pwDelta, setPwDelta] = useState(sequence.pw_delta?.toString() ?? "");
  const [priDelta, setPriDelta] = useState(sequence.pri_delta?.toString() ?? "");

  function commit(field: "rf_delta" | "pw_delta" | "pri_delta", raw: string) {
    const value = raw.trim() === "" ? null : Number(raw);
    if (value != null && Number.isNaN(value)) return;
    updateSequence.mutate({ sequenceId: sequence.id, input: { [field]: value } });
  }

  const field = (name: string, unit: string, value: string, set: (v: string) => void, key: "rf_delta" | "pw_delta" | "pri_delta") => (
    <label className="seq-delta" title={`${name} delta (±${unit}) for the Modes made from this sequence`}>
      {name} ±
      <input
        type="number"
        step="any"
        min="0"
        value={value}
        placeholder="0"
        aria-label={`${name} delta (±${unit})`}
        disabled={!canEdit}
        onChange={(e) => set(e.target.value)}
        onBlur={() => commit(key, value)}
      />
    </label>
  );
  return (
    <span className="seq-deltas">
      {field("RF", "MHz", rfDelta, setRfDelta, "rf_delta")}
      {field("PRI", "µs", priDelta, setPriDelta, "pri_delta")}
      {field("PW", "µs", pwDelta, setPwDelta, "pw_delta")}
    </span>
  );
}

/** Sequences with more steps than this start collapsed to a summary. */
const STEPS_OPEN_LIMIT = 10;

function SequenceSteps({
  steps,
  canEdit,
  deleting,
  onDeleteStep,
}: {
  steps: ParameterSequence["steps"];
  canEdit: boolean;
  deleting: boolean;
  onDeleteStep: (order: number) => void;
}) {
  return (
    <div className="long-list-scroll">
      <table className="data-table compact">
        <thead>
          <tr>
            <th className="num">Step</th>
            {STEP_COLUMNS.map((c) => (
              <th key={c.param}>{c.label}</th>
            ))}
            <th>Dwell (pulses)</th>
            <th aria-label="Delete" />
          </tr>
        </thead>
        <tbody>
          {steps.map((step) => (
            <tr key={step.order}>
              <td className="num hint-text">{step.order}</td>
              {STEP_COLUMNS.map((c) => (
                <td key={c.param} className="figure">
                  {stepValueText(step, c.param) ?? "—"}
                </td>
              ))}
              <td className="figure">{step.dwell_s ?? "—"}</td>
              <td>
                <button
                  type="button"
                  className="el-delete"
                  onClick={() => onDeleteStep(step.order)}
                  disabled={deleting || !canEdit}
                  title={canEdit ? `Delete step ${step.order}` : "Start editing this Emitter first"}
                  aria-label={`Delete step ${step.order}`}
                >
                  ✕
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** One sequence: a line with its name, size, range and deltas, and its steps
 * under it (folded away when there are many). */
function SequenceCard({
  emitterId,
  sourceId,
  seq,
  canEdit,
  deletingStep,
  onDelete,
  onDeleteStep,
}: {
  emitterId: string;
  sourceId: string;
  seq: ParameterSequence;
  canEdit: boolean;
  deletingStep: boolean;
  onDelete: () => void;
  onDeleteStep: (order: number) => void;
}) {
  const [open, setOpen] = useState(seq.steps.length <= STEPS_OPEN_LIMIT);
  const updateSequence = useUpdateParameterSequence(emitterId, sourceId);
  return (
    <section className="seq-card" aria-label={`Sequence ${seq.label || "unnamed"}`}>
      <header className="seq-card-head">
        <button type="button" className="link-button seq-card-toggle" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          {open ? "▾" : "▸"} <strong>{seq.label || "Sequence"}</strong>
        </button>
        {seq.variant && <span className="hint-text">{seq.variant.replace("_", " ")}</span>}
        <SequenceKindControl
          kind={seq.kind}
          guessedKind={seq.guessed_kind}
          hasPri={seq.steps.some((st) => stepHas(st, "pri"))}
          disabled={!canEdit || updateSequence.isPending}
          onChange={(kind) => updateSequence.mutate({ sequenceId: seq.id, input: { kind } })}
        />
        <span className="hint-text">
          {seq.steps.length} step{seq.steps.length === 1 ? "" : "s"} · {sequenceRangeSummary(seq.steps) || "no values"}
        </span>
        {!isPriOnlySequence(seq) && <SequenceDeltaEditor emitterId={emitterId} sourceId={sourceId} sequence={seq} canEdit={canEdit} />}
        <button
          type="button"
          className="link-button link-button-danger seq-card-delete"
          onClick={onDelete}
          disabled={!canEdit}
          title={canEdit ? undefined : "Start editing this Emitter first"}
        >
          Delete…
        </button>
      </header>
      {open && <SequenceSteps steps={seq.steps} canEdit={canEdit} deleting={deletingStep} onDeleteStep={onDeleteStep} />}
    </section>
  );
}

/** A Source's Parameter Sequences: each a set of steps (an RF, PRI and PW
 * per step) that Generate Modes can use. Added here too. */
export function ParameterSequencesPanel({ emitterId, sourceId }: { emitterId: string; sourceId: string }) {
  const { data: sequences } = useParameterSequences(emitterId, sourceId);
  const deleteSequence = useDeleteParameterSequence(emitterId, sourceId);
  const deleteStep = useDeleteParameterSequenceStep(emitterId, sourceId);
  const { confirmDelete, dialog } = useConfirmDialog();
  const { data: emitter } = useEmitter(emitterId);
  const { canEdit } = useEmitterCheckoutState(emitter);
  const canWrite = useHasRole("editor");
  const [adding, setAdding] = useState(false);
  const list = sequences ?? [];
  const guessed = list.filter((q) => q.kind == null).length;

  async function handleDeleteSequence(seqId: string, label: string) {
    if (await confirmDelete(`Delete sequence '${label}'?`)) {
      await deleteSequence.mutateAsync(seqId);
    }
  }

  async function handleDeleteStep(seqId: string, order: number) {
    if (await confirmDelete(`Delete step ${order}?`)) {
      await deleteStep.mutateAsync({ sequenceId: seqId, stepOrder: order });
    }
  }

  return (
    <div className="seq-panel">
      <div className="el-toolbar">
        <span className="hint-text">
          {list.length} sequence{list.length === 1 ? "" : "s"}
          {guessed > 0 && (
            <>
              {" "}
              · <span className="seq-kind-guessed">{guessed} with a guessed kind</span> — pick Stagger or Dwell &amp; switch
              on each to set it
            </>
          )}
        </span>
        {canWrite && !adding && (
          <button
            type="button"
            className="button secondary small"
            onClick={() => setAdding(true)}
            disabled={!canEdit}
            title={canEdit ? undefined : "Start editing this Emitter first"}
          >
            + Add sequence
          </button>
        )}
      </div>
      {canWrite && adding && (
        <fieldset className="edit-lock" disabled={!canEdit}>
          <SequenceForm
            emitterId={emitterId}
            sourceId={sourceId}
            canEdit={canEdit}
            onCancel={() => setAdding(false)}
            onAdded={() => setAdding(false)}
          />
        </fieldset>
      )}
      {sequences && list.length === 0 && !adding && (
        <p className="hint-text">
          None yet. A sequence is a list of steps, each with an RF, PRI and/or PW — Generate Modes can use its steps
          (e.g. as one stagger).
        </p>
      )}
      {list.map((seq) => (
        <SequenceCard
          key={seq.id}
          emitterId={emitterId}
          sourceId={sourceId}
          seq={seq}
          canEdit={canEdit}
          deletingStep={deleteStep.isPending}
          onDelete={() => void handleDeleteSequence(seq.id, seq.label || "unnamed")}
          onDeleteStep={(order) => void handleDeleteStep(seq.id, order)}
        />
      ))}
      {dialog}
    </div>
  );
}
