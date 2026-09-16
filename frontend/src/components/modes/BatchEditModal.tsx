import { useState, type FormEvent } from "react";
import { Modal } from "../common/Modal";
import { useBatchEditModes } from "../../state/hooks/useModes";
import { ApiRequestError } from "../../api/client";
import type { EwGroup } from "../../types/domain";
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
  onClose,
  onDone,
}: {
  emitterId: string;
  modeIds: string[];
  ewGroups: EwGroup[];
  onClose: () => void;
  onDone: () => void;
}) {
  const batchEdit = useBatchEditModes(emitterId);

  const [ewGroupId, setEwGroupId] = useState("");
  const [notes, setNotes] = useState("");
  const [rfRangeMatching, setRfRangeMatching] = useState<TriState>("");
  const [pwRangeMatching, setPwRangeMatching] = useState<TriState>("");
  const [priRangeMatching, setPriRangeMatching] = useState<TriState>("");
  const [rfDelta, setRfDelta] = useState("");
  const [pwDelta, setPwDelta] = useState("");
  const [priDelta, setPriDelta] = useState("");
  const [frameTimeDelta, setFrameTimeDelta] = useState("");

  const [errors, setErrors] = useState<ModeBatchEditError[] | null>(null);
  const [genericError, setGenericError] = useState<string | null>(null);

  function buildFields(): BatchModeFieldEdit {
    const fields: BatchModeFieldEdit = {};
    if (ewGroupId) fields.ew_group_id = ewGroupId;
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
    try {
      await batchEdit.mutateAsync({ mode_ids: modeIds, fields });
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
          <div className="batch-edit-grid batch-edit-grid-2">
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

        <div className="batch-edit-actions">
          <button type="button" className="icon-button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" disabled={batchEdit.isPending}>
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
