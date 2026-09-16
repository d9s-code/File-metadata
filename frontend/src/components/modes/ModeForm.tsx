import { useEffect, useState, type FormEvent } from "react";
import { useCreateMode, useUpdateMode } from "../../state/hooks/useModes";
import { ApiRequestError } from "../../api/client";
import type { EwGroup, Mode, PriType, Source } from "../../types/domain";
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
  initialData,
  onClose,
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
   * are also copied, but only when the observed pri_type matches this
   * form's
   * own selected priType — a stagger sequence observed under one PRI type is
   * meaningless (and rejected by the backend) under a different one. Deltas
   * are never pre-filled — those follow the same manual-entry rules as any
   * other Mode. */
  observedValueOptions?: { modeName: string; values: ObservedValues }[];
  initialData?: Mode;
  onClose?: () => void;
}) {
  const [ewGroupId, setEwGroupId] = useState(defaultEwGroupId || ewGroups[0]?.id || "");
  const [sourceId, setSourceId] = useState(sources[0]?.id ?? "");
  const [name, setName] = useState("");
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
  const [frameTimeDelta, setFrameTimeDelta] = useState("");
  const [rfRangeMatching, setRfRangeMatching] = useState(false);
  const [pwRangeMatching, setPwRangeMatching] = useState(false);
  const [priRangeMatching, setPriRangeMatching] = useState(false);
  const [notes, setNotes] = useState("");
  const [derivedFrom, setDerivedFrom] = useState<Set<string>>(new Set());
  const [showDerivedFrom, setShowDerivedFrom] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preFillFrom, setPreFillFrom] = useState(observedValueOptions?.[0]?.modeName ?? "");

  const createMode = useCreateMode(ewGroupId, emitterId);
  const updateMode = useUpdateMode(emitterId);

  useEffect(() => {
    if (initialData) {
      setEwGroupId(initialData.ew_group_id);
      setSourceId(initialData.source_id);
      setName(initialData.name);
      setPriType(initialData.pri_type);
      setNotes(initialData.notes || "");
      
      if (initialData.line) {
        setRfMin(String(initialData.line.rf_min_mhz));
        setRfMax(String(initialData.line.rf_max_mhz));
        setRfDelta(String(initialData.line.rf_delta));
        setPwMin(String(initialData.line.pw_min_us));
        setPwMax(String(initialData.line.pw_max_us));
        setPwDelta(String(initialData.line.pw_delta));
        setRfRangeMatching(initialData.line.rf_range_matching);
        setPwRangeMatching(initialData.line.pw_range_matching);
        setPriRangeMatching(initialData.line.pri_range_matching);

        if (initialData.pri_type === "fixed") {
          setPriMin(String(initialData.line.pri_min_us ?? ""));
          setPriMax(String(initialData.line.pri_max_us ?? ""));
          setPriDelta(String(initialData.line.pri_delta ?? ""));
          setJitterMin(String(initialData.line.jitter_min_us ?? ""));
          setJitterMax(String(initialData.line.jitter_max_us ?? ""));
        } else if (initialData.pri_type === "stagger" && initialData.line.pri_stagger_values_us) {
          setStaggerValues(initialData.line.pri_stagger_values_us.join(", "));
        }
        if (initialData.line.frame_time_delta_us) {
          setFrameTimeDelta(String(initialData.line.frame_time_delta_us));
        }
      }

      if (initialData.derived_from_test_records) {
        setDerivedFrom(new Set(initialData.derived_from_test_records.map((r) => r.id)));
      }
    }
  }, [initialData, ewGroups, sources]);

  useEffect(() => {
    if (!observedValueOptions?.length) return;
    if (!observedValueOptions.some((o) => o.modeName === preFillFrom)) {
      setPreFillFrom(observedValueOptions[0].modeName);
    }
  }, [observedValueOptions, preFillFrom]);

  function applyPreFill() {
    const values = observedValueOptions?.find((o) => o.modeName === preFillFrom)?.values;
    if (!values) return;
    if (values.rf_min_mhz != null) setRfMin(String(values.rf_min_mhz));
    if (values.rf_max_mhz != null) setRfMax(String(values.rf_max_mhz));
    if (values.pw_min_us != null) setPwMin(String(values.pw_min_us));
    if (values.pw_max_us != null) setPwMax(String(values.pw_max_us));
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

  const suggestedFrameTimeUs = staggerValues
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number)
    .reduce((sum, v) => (Number.isFinite(v) ? sum + v : sum), 0);

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

    const linePayload = {
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
          ? staggerValues
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
              .map(Number)
          : undefined,
      frame_time_delta_us: priType === "stagger" ? Number(frameTimeDelta) : undefined,
    };

    if (onStage) {
      const payload: ModeCreateInput = {
        source_id: sourceId,
        name,
        pri_type: priType,
        notes: notes || undefined,
        line: linePayload,
      };
      onStage(ewGroupId, payload);
      return;
    }

    try {
      if (initialData) {
        await updateMode.mutateAsync({
          ewGroupId,
          modeId: initialData.id,
          input: {
            name,
            notes: notes || undefined,
            ew_group_id: ewGroupId,
            source_id: sourceId,
            line: linePayload,
          },
        });
      } else {
        const payload: ModeCreateInput = {
          source_id: sourceId,
          name,
          pri_type: priType,
          notes: notes || undefined,
          line: linePayload,
        };
        await createMode.mutateAsync({
          ...payload,
          derived_from_test_record_ids: fixedDerivedFromTestRecordId ? [fixedDerivedFromTestRecordId] : [...derivedFrom],
        });
      }
      onClose?.();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Failed to save Mode");
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

      <div className="form-row param-row">
        <span className="param-row-label">Range matching</span>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={rfRangeMatching}
            onChange={(e) => setRfRangeMatching(e.target.checked)}
          />
          RF
        </label>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={pwRangeMatching}
            onChange={(e) => setPwRangeMatching(e.target.checked)}
          />
          PW
        </label>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={priRangeMatching}
            onChange={(e) => setPriRangeMatching(e.target.checked)}
          />
          PRI
        </label>
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
        <div className="form-row param-row">
          <label className="wide-label">
            Stagger sequence (comma-separated µs, in order)
            <input
              placeholder="800, 850, 900, 780"
              value={staggerValues}
              onChange={(e) => setStaggerValues(e.target.value)}
              required
            />
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

      <div className="form-row">
        <button type="submit" disabled={!onStage && (initialData ? updateMode.isPending : createMode.isPending)}>
          {onStage ? "Stage this Mode" : (initialData ? "Update Mode" : "Add Mode")}
        </button>
        {onClose && (
          <button type="button" className="icon-button" onClick={() => onClose()}>
            Cancel
          </button>
        )}
      </div>
      {error && <div className="error-text">{error}</div>}
    </form>
  );
}
