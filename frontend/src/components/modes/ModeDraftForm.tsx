import { useState, type FormEvent } from "react";
import { useProposeModeDraft } from "../../state/hooks/useModes";
import { ApiRequestError } from "../../api/client";
import type { Mode, PriType } from "../../types/domain";
import { DerivedFromPicker } from "./DerivedFromPicker";

const PRI_TYPES: PriType[] = ["fixed", "stagger", "cw", "xlet"];

export function ModeDraftForm({
  emitterId,
  mode,
  onDone,
}: {
  emitterId: string;
  mode: Mode;
  onDone: () => void;
}) {
  const proposeDraft = useProposeModeDraft(emitterId);
  const line = mode.line;
  const [priType, setPriType] = useState<PriType>(mode.pri_type);
  const [rfMin, setRfMin] = useState(String(line?.rf_min_mhz ?? ""));
  const [rfMax, setRfMax] = useState(String(line?.rf_max_mhz ?? ""));
  const [rfDelta, setRfDelta] = useState(String(line?.rf_delta ?? ""));
  const [pwMin, setPwMin] = useState(String(line?.pw_min_us ?? ""));
  const [pwMax, setPwMax] = useState(String(line?.pw_max_us ?? ""));
  const [pwDelta, setPwDelta] = useState(String(line?.pw_delta ?? ""));
  const [priMin, setPriMin] = useState(String(line?.pri_min_us ?? ""));
  const [priMax, setPriMax] = useState(String(line?.pri_max_us ?? ""));
  const [priDelta, setPriDelta] = useState(String(line?.pri_delta ?? ""));
  const [jitterMin, setJitterMin] = useState(String(line?.jitter_min_us ?? ""));
  const [jitterMax, setJitterMax] = useState(String(line?.jitter_max_us ?? ""));
  const [staggerValues, setStaggerValues] = useState(line?.pri_stagger_values_us?.join(", ") ?? "");
  const [derivedFrom, setDerivedFrom] = useState<Set<string>>(new Set());
  const [showDerivedFrom, setShowDerivedFrom] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await proposeDraft.mutateAsync({
        ewGroupId: mode.ew_group_id,
        modeId: mode.id,
        input: {
          pri_type: priType,
          line: {
            rf_min_mhz: Number(rfMin),
            rf_max_mhz: Number(rfMax),
            rf_delta: Number(rfDelta),
            pw_min_us: Number(pwMin),
            pw_max_us: Number(pwMax),
            pw_delta: Number(pwDelta),
            pri_min_us: priType === "fixed" ? Number(priMin) : undefined,
            pri_max_us: priType === "fixed" ? Number(priMax) : undefined,
            pri_delta: priType === "fixed" ? Number(priDelta) : undefined,
            jitter_min_us: priType === "fixed" ? Number(jitterMin) : undefined,
            jitter_max_us: priType === "fixed" ? Number(jitterMax) : undefined,
            pri_stagger_values_us:
              priType === "stagger"
                ? staggerValues.split(",").map((s) => s.trim()).filter(Boolean).map(Number)
                : undefined,
          },
          derived_from_test_record_ids: [...derivedFrom],
        },
      });
      onDone();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Failed to propose draft edit");
    }
  }

  return (
    <form className="card mode-form mode-draft-form" onSubmit={handleSubmit}>
      <p className="hint-text">
        Proposing a line edit to <strong>{mode.name}</strong> — this creates a pending draft that supersedes
        the current line once approved. The current Mode stays live and unchanged until then.
      </p>
      <div className="form-row">
        <select value={priType} onChange={(e) => setPriType(e.target.value as PriType)}>
          {PRI_TYPES.map((t) => (
            <option key={t} value={t}>
              {t.toUpperCase()}
            </option>
          ))}
        </select>
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
        <div className="form-row">
          <label className="wide-label">
            Stagger sequence (comma-separated µs, in order)
            <input value={staggerValues} onChange={(e) => setStaggerValues(e.target.value)} required />
          </label>
        </div>
      )}

      {priType === "cw" && <p className="hint-text">CW: PRI is constant — no value to enter.</p>}
      {priType === "xlet" && <p className="hint-text">Xlet: no fields defined yet.</p>}

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
        <button type="submit" disabled={proposeDraft.isPending}>
          Submit for review
        </button>
        <button type="button" className="icon-button" onClick={onDone}>
          Cancel
        </button>
      </div>
      {error && <div className="error-text">{error}</div>}
    </form>
  );
}
