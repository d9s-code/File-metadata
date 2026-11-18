import { useState, type FormEvent } from "react";
import { Modal } from "../common/Modal";
import { formatDate } from "../common/dates";
import { useEmitterTestRecords } from "../../state/hooks/useTestRecords";
import { testResultLabel, testTypeLabel } from "../testing/testFormat";
import { useBatchEditModes } from "../../state/hooks/useModes";
import { ApiRequestError } from "../../api/client";
import type { EwGroup, Source } from "../../types/domain";
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
  sources,
  onClose,
  onDone,
}: {
  emitterId: string;
  modeIds: string[];
  ewGroups: EwGroup[];
  sources?: Source[];
  onClose: () => void;
  onDone: () => void;
}) {
  const batchEdit = useBatchEditModes(emitterId);
  // Test-derived: the Emitter's own test runs whose findings explain these values.
  const { data: runs } = useEmitterTestRecords(emitterId);
  // Per run: mark the selected Modes derived from it, or remove that link.
  const [derivedAction, setDerivedAction] = useState<Map<string, "add" | "remove">>(new Map());
  const [runFilter, setRunFilter] = useState("");
  const sortedRuns = [...(runs ?? [])].sort((a, b) => b.test_date.localeCompare(a.test_date) || a.title.localeCompare(b.title));
  const shownRuns = runFilter.trim()
    ? sortedRuns.filter((r) => r.title.toLowerCase().includes(runFilter.trim().toLowerCase()) || derivedAction.has(r.id))
    : sortedRuns;
  const selected = new Set(modeIds);
  /** How many of the selected Modes are derived from this run already. */
  const linkedCount = (r: NonNullable<typeof runs>[number]) =>
    r.modes.filter((m) => m.link_type === "derived" && m.mode_id && selected.has(m.mode_id)).length;
  const toAdd = [...derivedAction].filter(([, a]) => a === "add").map(([id]) => id);
  const toRemove = [...derivedAction].filter(([, a]) => a === "remove").map(([id]) => id);
  function setRunAction(id: string, action: "" | "add" | "remove") {
    setDerivedAction((prev) => {
      const next = new Map(prev);
      if (action) next.set(id, action);
      else next.delete(id);
      return next;
    });
  }

  const [ewGroupId, setEwGroupId] = useState("");
  // "add:<id>" adds that Source to each Mode; "set:<id>" makes it each one's only Source.
  const [sourceChange, setSourceChange] = useState("");
  const [notes, setNotes] = useState("");
  const [rfRangeMatching, setRfRangeMatching] = useState<TriState>("");
  const [pwRangeMatching, setPwRangeMatching] = useState<TriState>("");
  const [priRangeMatching, setPriRangeMatching] = useState<TriState>("");
  const [rfDelta, setRfDelta] = useState("");
  const [pwDelta, setPwDelta] = useState("");
  const [priDelta, setPriDelta] = useState("");
  const [frameTimeDelta, setFrameTimeDelta] = useState("");
  const [jitterMin, setJitterMin] = useState("");
  const [jitterMax, setJitterMax] = useState("");
  const [confirmationQuality, setConfirmationQuality] = useState("");
  const [confirmationQuantity, setConfirmationQuantity] = useState("");

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
    if (sourceChange.startsWith("add:")) fields.add_source_id = sourceChange.slice(4);
    if (sourceChange.startsWith("set:")) fields.source_id = sourceChange.slice(4);
    if (notes.trim() !== "") fields.notes = notes;
    const quality = numOrUndefined(confirmationQuality);
    if (quality !== undefined) fields.confirmation_quality = quality;
    const quantity = numOrUndefined(confirmationQuantity);
    if (quantity !== undefined) fields.confirmation_quantity = quantity;
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
    const jMin = numOrUndefined(jitterMin);
    if (jMin !== undefined) fields.jitter_min_us = jMin;
    const jMax = numOrUndefined(jitterMax);
    if (jMax !== undefined) fields.jitter_max_us = jMax;
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
    if (Object.keys(fields).length === 0 && derivedAction.size === 0) {
      setGenericError("Set at least one field, or mark or unmark them test-derived.");
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
        derived_from_test_record_ids: toAdd.length ? toAdd : undefined,
        remove_derived_from_test_record_ids: toRemove.length ? toRemove : undefined,
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
    <Modal title={`Batch edit (${modeIds.length} selected)`} onClose={onClose} className="form-dialog">
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
                Sources
                <select value={sourceChange} onChange={(e) => setSourceChange(e.target.value)}>
                  <option value="">— leave unchanged —</option>
                  <optgroup label="Add to each Mode's Sources">
                    {sources.map((s) => (
                      <option key={s.id} value={`add:${s.id}`}>
                        + {s.name}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="Make it each Mode's only Source">
                    {sources.map((s) => (
                      <option key={s.id} value={`set:${s.id}`}>
                        Only {s.name}
                      </option>
                    ))}
                  </optgroup>
                </select>
              </label>
            )}
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
              PRI
              <select value={priRangeMatching} onChange={(e) => setPriRangeMatching(e.target.value as TriState)}>
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
            <label>
              PW (±µs)
              <input type="number" step="any" min="0" value={pwDelta} onChange={(e) => setPwDelta(e.target.value)} />
            </label>
          </div>
        </div>

        <div className="batch-edit-section">
          <span className="batch-edit-section-label">Jitter (Fixed PRI)</span>
          <p className="hint-text">Set on the selected Fixed Modes; Stagger, CW and X-let Modes have no jitter and are left as they are. One bound alone keeps the other.</p>
          <div className="batch-edit-grid batch-edit-grid-4">
            <label>
              Jitter min (µs)
              <input type="number" step="any" min="0" value={jitterMin} onChange={(e) => setJitterMin(e.target.value)} />
            </label>
            <label>
              Jitter max (µs)
              <input type="number" step="any" min="0" value={jitterMax} onChange={(e) => setJitterMax(e.target.value)} />
            </label>
          </div>
        </div>

        <div className="batch-edit-section">
          <span className="batch-edit-section-label">Confirmation</span>
          <div className="batch-edit-grid batch-edit-grid-4">
            <label>
              Quality (0–100)
              <input
                type="number"
                step="1"
                min="0"
                max="100"
                value={confirmationQuality}
                onChange={(e) => setConfirmationQuality(e.target.value)}
              />
            </label>
            <label>
              Quantity
              <input
                type="number"
                step="1"
                min="1"
                value={confirmationQuantity}
                onChange={(e) => setConfirmationQuantity(e.target.value)}
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
              PRI min shift (µs, Fixed only)
              <input type="number" step="any" value={priMinShift} onChange={(e) => setPriMinShift(e.target.value)} />
            </label>
            <label>
              PRI max shift (µs, Fixed only)
              <input type="number" step="any" value={priMaxShift} onChange={(e) => setPriMaxShift(e.target.value)} />
            </label>
            <label>
              PW min shift (µs)
              <input type="number" step="any" value={pwMinShift} onChange={(e) => setPwMinShift(e.target.value)} />
            </label>
            <label>
              PW max shift (µs)
              <input type="number" step="any" value={pwMaxShift} onChange={(e) => setPwMaxShift(e.target.value)} />
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

        <div className="batch-edit-section">
          <span className="batch-edit-section-label">
            Test-derived
            {toAdd.length > 0 && ` — marking from ${toAdd.length} run${toAdd.length === 1 ? "" : "s"}`}
            {toRemove.length > 0 && `${toAdd.length ? "," : " —"} removing ${toRemove.length}`}
          </span>
          <p className="hint-text">
            Mark the selected Modes as derived from test runs: their values come from what those runs found, not from a
            Source. Each gets the Test-derived badge and is listed under the run&apos;s &ldquo;Modes derived from this
            run&rdquo;. A Mode already linked to a run is left as it is. <strong>Remove</strong> takes the link to that run
            off the selected Modes that have it.
          </p>
          {!runs ? (
            <p className="hint-text">Loading the test runs…</p>
          ) : runs.length === 0 ? (
            <p className="hint-text">This Emitter has no test runs yet.</p>
          ) : (
            <>
              {runs.length > 8 && (
                <input
                  type="search"
                  className="batch-edit-run-filter"
                  placeholder="Find a test run…"
                  aria-label="Find a test run"
                  value={runFilter}
                  onChange={(e) => setRunFilter(e.target.value)}
                />
              )}
              <ul className="batch-edit-runs" aria-label="Test runs">
                {shownRuns.map((r) => {
                  const linked = linkedCount(r);
                  const action = derivedAction.get(r.id) ?? "";
                  return (
                    <li key={r.id} className={action ? `batch-edit-run-${action}` : undefined}>
                      <span className="batch-edit-run-title">{r.title}</span>
                      <span className="hint-text">
                        {formatDate(r.test_date)} · {testTypeLabel(r.test_type)}
                      </span>
                      <span className={`test-result-badge test-result-${r.result}`}>{testResultLabel(r.result)}</span>
                      <span className="hint-text batch-edit-run-linked" title="Selected Modes already derived from this run">
                        {linked ? `${linked} of ${modeIds.length} linked` : ""}
                      </span>
                      <select
                        aria-label={`Test-derived from ${r.title}`}
                        value={action}
                        onChange={(e) => setRunAction(r.id, e.target.value as "" | "add" | "remove")}
                      >
                        <option value="">Leave</option>
                        <option value="add" disabled={linked === modeIds.length}>
                          Mark derived
                        </option>
                        <option value="remove" disabled={linked === 0}>
                          Remove
                        </option>
                      </select>
                    </li>
                  );
                })}
                {shownRuns.length === 0 && <li className="hint-text">No test run matches.</li>}
              </ul>
            </>
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
