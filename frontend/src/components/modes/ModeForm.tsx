import { useState, type FormEvent } from "react";
import { useCreateMode } from "../../state/hooks/useModes";
import { ApiRequestError } from "../../api/client";
import type { EwGroup, PriType, Source } from "../../types/domain";
import type { ModeCreateInput } from "../../api/modes";
import type { ObservedValues } from "../../api/testRecords";
import { DerivedFromPicker } from "./DerivedFromPicker";

const PRI_TYPES: PriType[] = ["fixed", "stagger", "cw", "xlet"];

export function ModeForm({
  emitterId,
  ewGroups,
  sources,
  defaultEwGroupId,
  fixedDerivedFromTestRecordId,
  onStage,
  observedValueOptions,
}: {
  emitterId: string;
  ewGroups: EwGroup[];
  sources: Source[];
  defaultEwGroupId?: string;
  /** When set, this Mode is always linked as derived from this one Test
   * Record — the usual "is this test-derived?" toggle/picker is hidden. */
  fixedDerivedFromTestRecordId?: string;
  /** When set, submitting doesn't POST immediately — it hands the built
   * payload (plus the chosen EW Group, a call param separate from
   * ModeCreateInput) up to the caller to create later, e.g. once a Test
   * Record this Mode should be derived from actually exists in the DB.
   * Also hides the derived-from picker, same as fixedDerivedFromTestRecordId
   * — a staged Mode is inherently going to be test-derived once attached. */
  onStage?: (ewGroupId: string, input: ModeCreateInput) => void;
  /** Modes with observed values from the test in progress, offered as a
   * one-click pre-fill for this Mode's RF/PW/PRI min/max. Jitter and stagger
   * are also copied, but only when the observed pri_type matches this form's
   * own selected priType — a stagger sequence observed under one PRI type is
   * meaningless (and rejected by the backend) under a different one. Deltas
   * are never pre-filled — those follow the same manual-entry rules as any
   * other Mode. */
  observedValueOptions?: { modeName: string; values: ObservedValues }[];
}) {
  const [ewGroupId, setEwGroupId] = useState(defaultEwGroupId || ewGroups[0]?.id || "");
  const createMode = useCreateMode(ewGroupId, emitterId);
  const [name, setName] = useState("");
  const [sourceId, setSourceId] = useState(sources[0]?.id ?? "");
  const [priType, setPriType] = useState<PriType>("fixed");
  const [rfMin, setRfMin] = useState("");
  const [rfMax, setRfMax] = useState("");
  const [rfDelta, setRfDelta] = useState("");
  const [pwMin, setPwMin] = useState("");
  const [pwMax, setPwMax] = useState("");
  const [pwDelta, setPwDelta] = useState("");
  const [priMin, setPriMin] = useState("");
  const [priMax, setPriMax] = useState("");
  const [priDelta, setPriDelta] = useState("");
  const [jitterMin, setJitterMin] = useState("");
  const [jitterMax, setJitterMax] = useState("");
  const [staggerValues, setStaggerValues] = useState("");
  const [notes, setNotes] = useState("");
  const [derivedFrom, setDerivedFrom] = useState<Set<string>>(new Set());
  const [showDerivedFrom, setShowDerivedFrom] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preFillFrom, setPreFillFrom] = useState(observedValueOptions?.[0]?.modeName ?? "");

  function applyPreFill() {
    const values = observedValueOptions?.find((o) => o.modeName === preFillFrom)?.values;
    if (!values) return;
    if (values.rf_min_mhz != null) setRfMin(String(values.rf_min_mhz));
    if (values.rf_max_mhz != null) setRfMax(String(values.rf_max_mhz));
    if (values.pw_min_us != null) setPwMin(String(values.pw_min_us));
    if (values.pw_max_us != null) setPwMax(String(values.pw_max_us));
    // Only copy PRI-shaped fields when the observed pri_type matches this
    // form's own selected priType.
    if (values.pri_type === priType) {
      if (priType === "fixed") {
        if (values.pri_min_us != null) setPriMin(String(values.pri_min_us));
        if (values.pri_max_us != null) setPriMax(String(values.pri_max_us));
        if (values.jitter_min_us != null) setJitterMin(String(values.jitter_min_us));
        if (values.jitter_max_us != null) setJitterMax(String(values.jitter_max_us));
      } else if (priType === "stagger" && values.pri_stagger_values_us?.length) {
        setStaggerValues(values.pri_stagger_values_us.join(", "));
      }
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!ewGroupId) {
      setError("An EW Group is required — create one first.");
      return;
    }
    if (!sourceId) {
      setError("A Source is required — create one first.");
      return;
    }
    const payload: ModeCreateInput = {
      source_id: sourceId,
      name,
      pri_type: priType,
      notes: notes || undefined,
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
            ? staggerValues
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean)
                .map(Number)
            : undefined,
      },
    };
    if (onStage) {
      onStage(ewGroupId, payload);
      setName("");
      setRfMin("");
      setRfMax("");
      setRfDelta("");
      setPwMin("");
      setPwMax("");
      setPwDelta("");
      setPriMin("");
      setPriMax("");
      setPriDelta("");
      setJitterMin("");
      setJitterMax("");
      setStaggerValues("");
      setNotes("");
      return;
    }
    try {
      await createMode.mutateAsync({
        ...payload,
        derived_from_test_record_ids: fixedDerivedFromTestRecordId ? [fixedDerivedFromTestRecordId] : [...derivedFrom],
      });
      setName("");
      setRfMin("");
      setRfMax("");
      setRfDelta("");
      setPwMin("");
      setPwMax("");
      setPwDelta("");
      setPriMin("");
      setPriMax("");
      setPriDelta("");
      setJitterMin("");
      setJitterMax("");
      setStaggerValues("");
      setNotes("");
      setDerivedFrom(new Set());
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Failed to create Mode");
    }
  }

  return (
    <form className="card mode-form" onSubmit={handleSubmit}>
      <div className="form-row">
        <input placeholder="Mode name" value={name} onChange={(e) => setName(e.target.value)} required />
        <select value={ewGroupId} onChange={(e) => setEwGroupId(e.target.value)} required>
          <option value="" disabled>
            Select EW Group…
          </option>
          {ewGroups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
        <select value={sourceId} onChange={(e) => setSourceId(e.target.value)} required>
          <option value="" disabled>
            Select source…
          </option>
          {sources.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <select value={priType} onChange={(e) => setPriType(e.target.value as PriType)}>
          {PRI_TYPES.map((t) => (
            <option key={t} value={t}>
              {t.toUpperCase()}
            </option>
          ))}
        </select>
      </div>

      {observedValueOptions && observedValueOptions.length > 0 && (
        <div className="form-row">
          <label className="wide-label">
            Pre-fill from observed values (optional)
            <span className="form-row">
              <select value={preFillFrom} onChange={(e) => setPreFillFrom(e.target.value)}>
                {observedValueOptions.map((o) => (
                  <option key={o.modeName} value={o.modeName}>
                    {o.modeName}
                  </option>
                ))}
              </select>
              <button type="button" className="link-button" onClick={applyPreFill}>
                Pre-fill
              </button>
            </span>
          </label>
        </div>
      )}

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
          <input
            type="number"
            step="any"
            min="0"
            value={rfDelta}
            onChange={(e) => setRfDelta(e.target.value)}
            title="Symmetric tolerance margin applied to RF min/max to derive the engineered value"
            required
          />
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
          <input
            type="number"
            step="any"
            min="0"
            value={pwDelta}
            onChange={(e) => setPwDelta(e.target.value)}
            title="Symmetric tolerance margin applied to PW min/max to derive the engineered value"
            required
          />
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
            <input
              type="number"
              step="any"
              min="0"
              value={priDelta}
              onChange={(e) => setPriDelta(e.target.value)}
              title="Symmetric tolerance margin applied to PRI min/max to derive the engineered value"
              required
            />
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
            <input
              placeholder="800, 850, 900, 780"
              value={staggerValues}
              onChange={(e) => setStaggerValues(e.target.value)}
              required
            />
          </label>
        </div>
      )}

      {priType === "cw" && <p className="hint-text">CW: PRI is constant — no value to enter.</p>}
      {priType === "xlet" && <p className="hint-text">Xlet: no fields defined yet.</p>}

      <div className="form-row">
        <label className="wide-label">
          Notes (optional)
          <textarea
            placeholder="Any context worth recording about this Mode…"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={4}
          />
        </label>
      </div>

      {!fixedDerivedFromTestRecordId && !onStage && (
        <div>
          {showDerivedFrom ? (
            <>
              <h5>Explained by test result(s)</h5>
              <DerivedFromPicker emitterId={emitterId} selected={derivedFrom} onChange={setDerivedFrom} />
            </>
          ) : (
            <button type="button" className="link-button" onClick={() => setShowDerivedFrom(true)}>
              + This Mode is test-derived (not from the Source)
            </button>
          )}
        </div>
      )}

      <button type="submit" disabled={!onStage && createMode.isPending}>
        {onStage ? "Stage this Mode" : "Add Mode"}
      </button>
      {error && <div className="error-text">{error}</div>}
    </form>
  );
}
