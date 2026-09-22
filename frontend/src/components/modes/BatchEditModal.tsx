import { useState, type FormEvent } from "react";
import { Modal } from "../common/Modal";
import { useBatchEditModes } from "../../state/hooks/useModes";
import { ApiRequestError } from "../../api/client";
import type { EwGroup, FunctionGroup, Source } from "../../types/domain";
import type { BatchModeFieldEdit, ModeBatchEditError } from "../../api/modes";

type TriState = "" | "true" | "false";

function triStateToBool(v: TriState): boolean | undefined {
  return v === "" ? undefined : v === "true";
}

function numOrUndefined(raw: string): number | undefined {
  return raw.trim() === "" ? undefined : Number(raw);
}

export function BatchEditModal({
  emitterId,
  modeIds,
  ewGroups,
  functionGroups,
  sources,
  onClose,
  onDone,
}: {
  emitterId: string;
  modeIds: string[];
  ewGroups: EwGroup[];
  functionGroups?: FunctionGroup[];
  sources?: Source[];
  onClose: () => void;
  onDone: () => void;
}) {
  const batchEdit = useBatchEditModes(emitterId);

  const [ewGroupId, setEwGroupId] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [functionGroupId, setFunctionGroupId] = useState("");
  const [notes, setNotes] = useState("");
  const [rfRangeMatching, setRfRangeMatching] = useState<TriState>("");
  const [pwRangeMatching, setPwRangeMatching] = useState<TriState>("");
  const [priRangeMatching, setPriRangeMatching] = useState<TriState>("");
  const [rfDelta, setRfDelta] = useState("");
  const [pwDelta, setPwDelta] = useState("");
  const [priDelta, setPriDelta] = useState("");
  const [frameTimeDelta, setFrameTimeDelta] = useState("");

  const [rfMinShift, setRfMinShift] = useState("");
  const [rfMaxShift, setRfMaxShift] = useState("");
  const [pwMinShift, setPwMinShift] = useState("");
  const [pwMaxShift, setPwMaxShift] = useState("");
  const [priMinShift, setPriMinShift] = useState("");
  const [priMaxShift, setPriMaxShift] = useState("");
  const [shiftReason, setShiftReason] = useState("");

  const [errors, setErrors] = useState<ModeBatchEditError[] | null>(null);
  const [genericError, setGenericError] = useState<string | null>(null);

  const hasShift =
    rfMinShift.trim() !== "" ||
    rfMaxShift.trim() !== "" ||
    pwMinShift.trim() !== "" ||
    pwMaxShift.trim() !== "" ||
    priMinShift.trim() !== "" ||
    priMaxShift.trim() !== "";

  function buildFields(): BatchModeFieldEdit {
    const fields: BatchModeFieldEdit = {};
    if (ewGroupId) fields.ew_group_id = ewGroupId;
    if (sourceId) fields.source_id = sourceId;
    if (functionGroupId) fields.function_group_id = functionGroupId;
    if (notes.trim() !== "") fields.notes = notes;
    const rfRM = triStateToBool(rfRangeMatching);
    if (rfRM !== undefined) fields.rf_range_matching = rfRM;
    const pwRM = triStateToBool(pwRangeMatching);
    if (pwRM !== undefined) fields.pw_range_matching = pwRM;
    const priRM = triStateToBool(priRangeMatching);
    if (priRM !== undefined) fields.pri_range_matching = priRM;
    const rfD = numOrUndefined(rfDelta);
    if (rfD !== undefined) fields.rf_delta = rfD;
    const pwD = numOrUndefined(pwDelta);
    if (pwD !== undefined) fields.pw_delta = pwD;
    const priD = numOrUndefined(priDelta);
    if (priD !== undefined) fields.pri_delta = priD;
    const ftD = numOrUndefined(frameTimeDelta);
    if (ftD !== undefined) fields.frame_time_delta_us = ftD;
    const rfMinS = numOrUndefined(rfMinShift);
    if (rfMinS !== undefined) fields.rf_min_shift = rfMinS;
    const rfMaxS = numOrUndefined(rfMaxShift);
    if (rfMaxS !== undefined) fields.rf_max_shift = rfMaxS;
    const pwMinS = numOrUndefined(pwMinShift);
    if (pwMinS !== undefined) fields.pw_min_shift = pwMinS;
    const pwMaxS = numOrUndefined(pwMaxShift);
    if (pwMaxS !== undefined) fields.pw_max_shift = pwMaxS;
    const priMinS = numOrUndefined(priMinShift);
    if (priMinS !== undefined) fields.pri_min_shift = priMinS;
    const priMaxS = numOrUndefined(priMaxShift);
    if (priMaxS !== undefined) fields.pri_max_shift = priMaxS;
    return fields;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setErrors(null);
    setGenericError(null);
    const fields = buildFields();
    if (Object.keys(fields).length === 0) {
      setGenericError("Set at least one field.");
      return;
    }
    if (hasShift && shiftReason.trim() === "") {
      setGenericError("Explain why you're shifting these values — a reason is required.");
      return;
    }
    try {
      await batchEdit.mutateAsync({
        mode_ids: modeIds,
        fields,
        shift_reason: hasShift ? shiftReason.trim() : undefined,
      });
      onDone();
    } catch (err) {
      if (err instanceof ApiRequestError && Array.isArray(err.detail)) {
        setErrors(err.detail as ModeBatchEditError[]);
      } else {
        setGenericError(err instanceof ApiRequestError ? err.message : "Failed to batch-edit Modes");
      }
    }
  }

  return (
    <Modal title={`Batch Edit (${modeIds.length} selected)`} onClose={onClose} wide>
      <form className="batch-edit-form" onSubmit={handleSubmit}>
        <p className="hint-text">
          Applies to all {modeIds.length} selected Modes at once, all-or-nothing — if any one would
          end up invalid (e.g. a forbidden field for its PRI type), nothing is applied and every
          failure is listed below. Leave a field blank/unchanged to skip it.
        </p>

        <div className="batch-edit-section">
          <div className="batch-edit-grid batch-edit-grid-3">
            <label>
              EW Group
              <select value={ewGroupId} onChange={(e) => setEwGroupId(e.target.value)}>
                <option value="">— leave unchanged —</option>
                {ewGroups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Notes (overwrites all selected)
              <input value={notes} onChange={(e) => setNotes(e.target.value)} />
            </label>
            {sources && sources.length > 0 && (
              <label>
                Source
                <select value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
                  <option value="">— leave unchanged —</option>
                  {sources.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label>
              Function Group
              <select value={functionGroupId} onChange={(e) => setFunctionGroupId(e.target.value)}>
                <option value="">— leave unchanged —</option>
                {(functionGroups ?? []).map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        <div className="batch-edit-section">
          <span className="batch-edit-section-label">Range matching</span>
          <div className="batch-edit-grid batch-edit-grid-3">
            <label>
              RF
              <select value={rfRangeMatching} onChange={(e) => setRfRangeMatching(e.target.value as TriState)}>
                <option value="">unchanged</option>
                <option value="true">on</option>
                <option value="false">off</option>
              </select>
            </label>
            <label>
              PW
              <select value={pwRangeMatching} onChange={(e) => setPwRangeMatching(e.target.value as TriState)}>
                <option value="">unchanged</option>
                <option value="true">on</option>
                <option value="false">off</option>
              </select>
            </label>
            <label>
              PRI
              <select value={priRangeMatching} onChange={(e) => setPriRangeMatching(e.target.value as TriState)}>
                <option value="">unchanged</option>
                <option value="true">on</option>
                <option value="false">off</option>
              </select>
            </label>
          </div>
        </div>

        <div className="batch-edit-section">
          <span className="batch-edit-section-label">Deltas</span>
          <div className="batch-edit-grid batch-edit-grid-4">
            <label>
              RF (±MHz)
              <input type="number" step="any" min="0" value={rfDelta} onChange={(e) => setRfDelta(e.target.value)} />
            </label>
            <label>
              PW (±µs)
              <input type="number" step="any" min="0" value={pwDelta} onChange={(e) => setPwDelta(e.target.value)} />
            </label>
            <label>
              PRI (±µs, Fixed only)
              <input type="number" step="any" min="0" value={priDelta} onChange={(e) => setPriDelta(e.target.value)} />
            </label>
            <label>
              Frame time (±µs, Stagger only)
              <input
                type="number"
                step="any"
                min="0"
                value={frameTimeDelta}
                onChange={(e) => setFrameTimeDelta(e.target.value)}
              />
            </label>
          </div>
        </div>

        <div className="batch-edit-section">
          <span className="batch-edit-section-label">Shift existing values (add/remove a fixed amount)</span>
          <p className="hint-text">
            Shifts each bound independently — e.g. an RF min shift never touches RF max. A shift on a
            bound a Mode doesn't have (e.g. PRI on a CW Mode) is silently skipped for that Mode.
          </p>
          <div className="batch-edit-grid batch-edit-grid-4">
            <label>
              RF min shift (MHz)
              <input type="number" step="any" value={rfMinShift} onChange={(e) => setRfMinShift(e.target.value)} />
            </label>
            <label>
              RF max shift (MHz)
              <input type="number" step="any" value={rfMaxShift} onChange={(e) => setRfMaxShift(e.target.value)} />
            </label>
            <label>
              PW min shift (µs)
              <input type="number" step="any" value={pwMinShift} onChange={(e) => setPwMinShift(e.target.value)} />
            </label>
            <label>
              PW max shift (µs)
              <input type="number" step="any" value={pwMaxShift} onChange={(e) => setPwMaxShift(e.target.value)} />
            </label>
            <label>
              PRI min shift (µs, Fixed only)
              <input type="number" step="any" value={priMinShift} onChange={(e) => setPriMinShift(e.target.value)} />
            </label>
            <label>
              PRI max shift (µs, Fixed only)
              <input type="number" step="any" value={priMaxShift} onChange={(e) => setPriMaxShift(e.target.value)} />
            </label>
          </div>
          {hasShift && (
            <label className="batch-edit-shift-reason">
              Reason for this shift (required)
              <textarea
                value={shiftReason}
                onChange={(e) => setShiftReason(e.target.value)}
                placeholder="Why are these values being shifted?"
                required
              />
            </label>
          )}
        </div>

        <div className="batch-edit-actions">
          <button type="button" className="icon-button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" disabled={batchEdit.isPending || (hasShift && shiftReason.trim() === "")}>
            Apply to {modeIds.length} Mode{modeIds.length === 1 ? "" : "s"}
          </button>
        </div>

        {genericError && <div className="error-text">{genericError}</div>}
        {errors && (
          <div className="error-text">
            <p>Nothing was applied — {errors.length} of {modeIds.length} selected Mode(s) would be invalid:</p>
            <ul>
              {errors.map((e) => (
                <li key={e.mode_id}>
                  <strong>{e.mode_name}</strong>: {e.error}
                </li>
              ))}
            </ul>
          </div>
        )}
      </form>
    </Modal>
  );
}
