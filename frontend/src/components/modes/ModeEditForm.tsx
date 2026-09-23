import { useState, type FormEvent } from "react";
import { useUpdateMode } from "../../state/hooks/useModes";
import { ApiRequestError } from "../../api/client";
import type { FunctionGroup, Mode, PriType, Source } from "../../types/domain";
import { DerivedFromPicker } from "./DerivedFromPicker";

const PRI_TYPES: PriType[] = ["fixed", "stagger", "cw", "xlet"];

/** Edits an existing Mode's line in place, including its PRI type — changing
 * type always submits a full new line for it (the old type's fields, e.g.
 * Fixed's jitter, are meaningless under a new one), same as the backend
 * requires. */
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
  const line = mode.line;
  const [priType, setPriType] = useState<PriType>(mode.pri_type);
  const [sourceId, setSourceId] = useState(mode.source_id);
  const [rfMin, setRfMin] = useState(String(line?.rf_min_mhz ?? ""));
  const [rfMax, setRfMax] = useState(String(line?.rf_max_mhz ?? ""));
  const [rfDelta, setRfDelta] = useState(String(line?.rf_delta ?? ""));
  const [rfRangeMatching, setRfRangeMatching] = useState(line?.rf_range_matching ?? false);
  const [pwMin, setPwMin] = useState(String(line?.pw_min_us ?? ""));
  const [pwMax, setPwMax] = useState(String(line?.pw_max_us ?? ""));
  const [pwDelta, setPwDelta] = useState(String(line?.pw_delta ?? ""));
  const [pwRangeMatching, setPwRangeMatching] = useState(line?.pw_range_matching ?? false);
  const [priRangeMatching, setPriRangeMatching] = useState(line?.pri_range_matching ?? false);
  const [priMin, setPriMin] = useState(String(line?.pri_min_us ?? ""));
  const [priMax, setPriMax] = useState(String(line?.pri_max_us ?? ""));
  const [priDelta, setPriDelta] = useState(String(line?.pri_delta ?? ""));
  const [jitterMin, setJitterMin] = useState(String(line?.jitter_min_us ?? ""));
  const [jitterMax, setJitterMax] = useState(String(line?.jitter_max_us ?? ""));
  const [staggerValues, setStaggerValues] = useState(line?.pri_stagger_values_us?.join(", ") ?? "");
  const [frameTimeDelta, setFrameTimeDelta] = useState(String(line?.frame_time_delta_us ?? ""));
  const [notes, setNotes] = useState(mode.notes ?? "");
  const [functionGroupId, setFunctionGroupId] = useState(mode.function_group_id ?? "");
  const [derivedFrom, setDerivedFrom] = useState<Set<string>>(new Set());
  const [showDerivedFrom, setShowDerivedFrom] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const suggestedFrameTimeUs = staggerValues
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number)
    .reduce((sum, v) => (Number.isFinite(v) ? sum + v : sum), 0);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await updateMode.mutateAsync({
        ewGroupId: mode.ew_group_id,
        modeId: mode.id,
        input: {
          notes: notes.trim() || null,
          source_id: sourceId !== mode.source_id ? sourceId : undefined,
          function_group_id: functionGroupId || null,
          pri_type: priType !== mode.pri_type ? priType : undefined,
          line: {
            rf_min_mhz: Number(rfMin),
            rf_max_mhz: Number(rfMax),
            rf_delta: Number(rfDelta),
            rf_range_matching: rfRangeMatching,
            pw_min_us: Number(pwMin),
            pw_max_us: Number(pwMax),
            pw_delta: Number(pwDelta),
            pw_range_matching: pwRangeMatching,
            pri_range_matching: priRangeMatching,
            pri_min_us: priType === "fixed" ? Number(priMin) : undefined,
            pri_max_us: priType === "fixed" ? Number(priMax) : undefined,
            pri_delta: priType === "fixed" ? Number(priDelta) : undefined,
            jitter_min_us: priType === "fixed" ? Number(jitterMin) : undefined,
            jitter_max_us: priType === "fixed" ? Number(jitterMax) : undefined,
            pri_stagger_values_us:
              priType === "stagger"
                ? staggerValues.split(",").map((s) => s.trim()).filter(Boolean).map(Number)
                : undefined,
            frame_time_delta_us: priType === "stagger" ? Number(frameTimeDelta) : undefined,
          },
          derived_from_test_record_ids: [...derivedFrom],
        },
      });
      onDone();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Failed to update Mode");
    }
  }

  return (
    <form className="card mode-form mode-edit-form" onSubmit={handleSubmit}>
      <p className="hint-text">
        Editing <strong>{mode.name}</strong>&rsquo;s line — takes effect immediately.
      </p>

      <div className="form-row param-row">
        <span className="param-row-label">PRI Type</span>
        <select value={priType} onChange={(e) => setPriType(e.target.value as PriType)}>
          {PRI_TYPES.map((t) => (
            <option key={t} value={t}>
              {t.toUpperCase()}
            </option>
          ))}
        </select>
        {priType !== mode.pri_type && (
          <span className="hint-text">Changing PRI type replaces the line below — fill in all of its fields.</span>
        )}
      </div>

      <div className="form-row param-row">
        <span className="param-row-label">Range matching</span>
        <label className="checkbox-label">
          <input type="checkbox" checked={rfRangeMatching} onChange={(e) => setRfRangeMatching(e.target.checked)} />
          RF
        </label>
        <label className="checkbox-label">
          <input type="checkbox" checked={pwRangeMatching} onChange={(e) => setPwRangeMatching(e.target.checked)} />
          PW
        </label>
        <label className="checkbox-label">
          <input type="checkbox" checked={priRangeMatching} onChange={(e) => setPriRangeMatching(e.target.checked)} />
          PRI
        </label>
      </div>

      <div className="form-row param-row">
        <span className="param-row-label">RF</span>
        <label>
          min (MHz)
          <input type="number" step="any" value={rfMin} onChange={(e) => setRfMin(e.target.value)} required />
        </label>
        <label>
          max (MHz)
          <input type="number" step="any" value={rfMax} onChange={(e) => setRfMax(e.target.value)} required />
        </label>
        <label>
          delta (±MHz)
          <input type="number" step="any" min="0" value={rfDelta} onChange={(e) => setRfDelta(e.target.value)} required />
        </label>
      </div>

      <div className="form-row param-row">
        <span className="param-row-label">PW</span>
        <label>
          min (µs)
          <input type="number" step="any" value={pwMin} onChange={(e) => setPwMin(e.target.value)} required />
        </label>
        <label>
          max (µs)
          <input type="number" step="any" value={pwMax} onChange={(e) => setPwMax(e.target.value)} required />
        </label>
        <label>
          delta (±µs)
          <input type="number" step="any" min="0" value={pwDelta} onChange={(e) => setPwDelta(e.target.value)} required />
        </label>
      </div>

      {priType === "fixed" && (
        <div className="form-row param-row">
          <span className="param-row-label">PRI</span>
          <label>
            min (µs)
            <input type="number" step="any" value={priMin} onChange={(e) => setPriMin(e.target.value)} required />
          </label>
          <label>
            max (µs)
            <input type="number" step="any" value={priMax} onChange={(e) => setPriMax(e.target.value)} required />
          </label>
          <label>
            delta (±µs)
            <input type="number" step="any" min="0" value={priDelta} onChange={(e) => setPriDelta(e.target.value)} required />
          </label>
          <label>
            jitter min (µs)
            <input type="number" step="any" value={jitterMin} onChange={(e) => setJitterMin(e.target.value)} required />
          </label>
          <label>
            jitter max (µs)
            <input type="number" step="any" value={jitterMax} onChange={(e) => setJitterMax(e.target.value)} required />
          </label>
        </div>
      )}

      {priType === "stagger" && (
        <div className="form-row param-row">
          <label className="wide-label">
            Stagger sequence (comma-separated µs, in order)
            <input value={staggerValues} onChange={(e) => setStaggerValues(e.target.value)} required />
          </label>
          <label>
            frame time delta (±µs)
            <input
              type="number"
              step="any"
              min="0"
              value={frameTimeDelta}
              onChange={(e) => setFrameTimeDelta(e.target.value)}
              title="Symmetric tolerance margin applied to the suggested frame time (sum of the stagger sequence) to derive the engineered min/max"
              required
            />
          </label>
          {suggestedFrameTimeUs > 0 && (
            <span className="hint-text">Suggested frame time: {suggestedFrameTimeUs} µs</span>
          )}
        </div>
      )}

      {priType === "cw" && <p className="hint-text">CW: PRI is constant — no value to enter.</p>}
      {priType === "xlet" && <p className="hint-text">Xlet: no fields defined yet.</p>}

      <div className="form-row">
        <label className="wide-label">
          Notes (optional)
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
        </label>
        <label>
          Function Group
          <select value={functionGroupId} onChange={(e) => setFunctionGroupId(e.target.value)}>
            <option value="">— none —</option>
            {(functionGroups ?? []).map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </label>
        {sources && sources.length > 0 && (
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
        )}
      </div>

      <div>
        {showDerivedFrom ? (
          <>
            <h5>Explained by test result(s)</h5>
            <DerivedFromPicker emitterId={emitterId} selected={derivedFrom} onChange={setDerivedFrom} />
          </>
        ) : (
          <button type="button" className="link-button" onClick={() => setShowDerivedFrom(true)}>
            + Link this edit to a test finding
          </button>
        )}
      </div>

      <div className="form-row">
        <button type="submit" disabled={updateMode.isPending}>
          Save
        </button>
        <button type="button" className="icon-button" onClick={onDone}>
          Cancel
        </button>
      </div>
      {error && <div className="error-text">{error}</div>}
    </form>
  );
}
