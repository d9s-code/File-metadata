import { useEffect, useState, type FormEvent } from "react";
import { useCreateMode } from "../../state/hooks/useModes";
import { ApiRequestError } from "../../api/client";
import type { EwGroup, FunctionGroup, Mode, PriType, Source } from "../../types/domain";
import type { ModeCreateInput } from "../../api/modes";
import type { ObservedValueOption } from "../testing/testFormat";
import { DerivedFromPicker } from "./DerivedFromPicker";
import { FrameTimeInput, useFrameTimeField } from "./FrameTimeInput";
import { ConfirmationInputs, DEFAULT_CONFIRMATION_QUALITY, DEFAULT_CONFIRMATION_QUANTITY } from "./ConfirmationInputs";

const PRI_TYPES: PriType[] = ["fixed", "stagger", "cw", "xlet"];

export function ModeForm({
  emitterId,
  ewGroups,
  sources,
  functionGroups,
  defaultEwGroupId,
  fixedDerivedFromTestRecordId,
  fixedDerivedFromInterceptEntryId,
  onStage,
  observedValueOptions,
  duplicateFrom,
  onClose,
}: {
  emitterId: string;
  ewGroups: EwGroup[];
  sources: Source[];
  functionGroups?: FunctionGroup[];
  defaultEwGroupId?: string;
  /** When set, this Mode is always linked as derived from this one Test
   * Record — the usual "is this test-derived?" toggle/picker is hidden. */
  fixedDerivedFromTestRecordId?: string;
  /** When set, this Mode is always linked as derived from this one Intercept
   * Entry — same effect as fixedDerivedFromTestRecordId, for the "Create
   * Mode from this Entry" action on an Intercept's detail page. */
  fixedDerivedFromInterceptEntryId?: string;
  /** When set, submitting doesn't POST immediately — it hands the built
   * payload (plus the chosen EW Group, a call param separate from
   * ModeCreateInput) up to the caller to create later, e.g. once a Test
   * Record this Mode should be derived from actually exists in the DB.
   * Also hides the derived-from picker, same as fixedDerivedFromTestRecordId
   * — a staged Mode is inherently going to be test-derived once attached. */
  onStage?: (ewGroupId: string, input: ModeCreateInput) => void;
  /** Logged sets of intercepted parameters, one pickable option each, offered
   * as a one-click pre-fill. A mean fills both min and max; a set with a PRI
   * type also switches the form to it and fills its PRI values (PRI and
   * jitter for Fixed, sequence and frame time for Stagger). Deltas are never
   * pre-filled. */
  observedValueOptions?: ObservedValueOption[];
  /** Pre-fills every field from an existing Mode's line, except Name (left
   * blank — two Modes can't share one). Submitting still creates a new
   * Mode; it just starts from a known-good line instead of a blank one. */
  duplicateFrom?: Mode;
  onClose?: () => void;
}) {
  const [ewGroupId, setEwGroupId] = useState(defaultEwGroupId || ewGroups[0]?.id || "");
  const [sourceId, setSourceId] = useState(sources[0]?.id ?? "");
  const [functionGroupId, setFunctionGroupId] = useState("");
  const [name, setName] = useState("");
  const [priType, setPriType] = useState<PriType>("fixed");
  const [rfMin, setRfMin] = useState("");
  const [rfMax, setRfMax] = useState("");
  // Deltas start at 0 — overwrite them when the Source gives a tolerance.
  const [rfDelta, setRfDelta] = useState("0");
  const [pwMin, setPwMin] = useState("");
  const [pwMax, setPwMax] = useState("");
  const [pwDelta, setPwDelta] = useState("0");
  const [priMin, setPriMin] = useState("");
  const [priMax, setPriMax] = useState("");
  const [priDelta, setPriDelta] = useState("0");
  // Jitter starts at 0–1 µs, like the deltas start at 0.
  const [jitterMin, setJitterMin] = useState("0");
  const [jitterMax, setJitterMax] = useState("1");
  const [staggerValues, setStaggerValues] = useState("");
  const [frameTimeDelta, setFrameTimeDelta] = useState("0");
  const frameTime = useFrameTimeField(staggerValues);
  const { load: loadFrameTime } = frameTime;
  const [confirmationQuality, setConfirmationQuality] = useState(String(DEFAULT_CONFIRMATION_QUALITY));
  const [confirmationQuantity, setConfirmationQuantity] = useState(String(DEFAULT_CONFIRMATION_QUANTITY));
  const [rfRangeMatching, setRfRangeMatching] = useState(false);
  const [pwRangeMatching, setPwRangeMatching] = useState(false);
  const [priRangeMatching, setPriRangeMatching] = useState(false);
  const [notes, setNotes] = useState("");
  const [derivedFrom, setDerivedFrom] = useState<Set<string>>(new Set());
  const [showDerivedFrom, setShowDerivedFrom] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preFillFrom, setPreFillFrom] = useState(observedValueOptions?.[0]?.key ?? "");

  const createMode = useCreateMode(ewGroupId, emitterId);

  useEffect(() => {
    const source = duplicateFrom;
    if (source) {
      setEwGroupId(source.ew_group_id);
      setSourceId(source.source_id);
      // A duplicate can't start with the original's name — two Modes can't
      // share one, and leaving it blank forces picking a real one rather
      // than silently failing on submit with an unexplained name clash.
      setName("");
      setPriType(source.pri_type);
      setNotes(source.notes || "");
      setFunctionGroupId(source.function_group_id ?? "");
      setConfirmationQuality(String(source.confirmation_quality));
      setConfirmationQuantity(String(source.confirmation_quantity));

      if (source.line) {
        setRfMin(String(source.line.rf_min_mhz));
        setRfMax(String(source.line.rf_max_mhz));
        setRfDelta(String(source.line.rf_delta ?? 0));
        setPwMin(String(source.line.pw_min_us));
        setPwMax(String(source.line.pw_max_us));
        setPwDelta(String(source.line.pw_delta ?? 0));
        setRfRangeMatching(source.line.rf_range_matching);
        setPwRangeMatching(source.line.pw_range_matching);
        setPriRangeMatching(source.line.pri_range_matching);

        if (source.pri_type === "fixed") {
          setPriMin(String(source.line.pri_min_us ?? ""));
          setPriMax(String(source.line.pri_max_us ?? ""));
          setPriDelta(String(source.line.pri_delta ?? 0));
          setJitterMin(String(source.line.jitter_min_us ?? 0));
          setJitterMax(String(source.line.jitter_max_us ?? 1));
        } else if (source.pri_type === "stagger" && source.line.pri_stagger_values_us) {
          setStaggerValues(source.line.pri_stagger_values_us.join(", "));
          setFrameTimeDelta(String(source.line.frame_time_delta_us ?? 0));
          loadFrameTime(source.line.explicit_frame_time_us);
        }
      }
      // Provenance isn't copied for a duplicate — it wasn't independently
      // derived from that test/intercept, it's a copy of a Mode that was.
    }
  }, [duplicateFrom, ewGroups, sources, loadFrameTime]);

  useEffect(() => {
    if (!observedValueOptions?.length) return;
    if (!observedValueOptions.some((o) => o.key === preFillFrom)) {
      setPreFillFrom(observedValueOptions[0].key);
    }
  }, [observedValueOptions, preFillFrom]);

  function applyPreFill() {
    const values = observedValueOptions?.find((o) => o.key === preFillFrom)?.values;
    if (!values) return;
    // A logged mean fills both min and max; sets logged before means were
    // introduced carry min/max directly.
    const fill = (mean: number | undefined, min: number | undefined, max: number | undefined,
                  setMin: (v: string) => void, setMax: (v: string) => void) => {
      const lo = min ?? mean;
      const hi = max ?? mean;
      if (lo != null) setMin(String(lo));
      if (hi != null) setMax(String(hi));
    };
    fill(values.rf_mean_mhz, values.rf_min_mhz, values.rf_max_mhz, setRfMin, setRfMax);
    fill(values.pw_mean_us, values.pw_min_us, values.pw_max_us, setPwMin, setPwMax);
    // The chosen set's PRI type wins — its PRI values only make sense under it.
    if (values.pri_type) {
      setPriType(values.pri_type);
      if (values.pri_type === "fixed") {
        fill(values.pri_mean_us, values.pri_min_us, values.pri_max_us, setPriMin, setPriMax);
        fill(values.jitter_mean_us, values.jitter_min_us, values.jitter_max_us, setJitterMin, setJitterMax);
      } else if (values.pri_type === "stagger" && values.pri_stagger_values_us?.length) {
        setStaggerValues(values.pri_stagger_values_us.join(", "));
        frameTime.load(values.frame_time_us);
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
      explicit_frame_time_us: priType === "stagger" ? frameTime.payload() : undefined,
    };
    const confirmation = {
      confirmation_quality: Number(confirmationQuality),
      confirmation_quantity: Number(confirmationQuantity),
    };

    if (onStage) {
      const payload: ModeCreateInput = {
        source_id: sourceId,
        name,
        pri_type: priType,
        notes: notes || undefined,
        ...confirmation,
        line: linePayload,
        function_group_id: functionGroupId || null,
      };
      onStage(ewGroupId, payload);
      return;
    }

    try {
      const payload: ModeCreateInput = {
        source_id: sourceId,
        name,
        pri_type: priType,
        notes: notes || undefined,
        ...confirmation,
        line: linePayload,
        function_group_id: functionGroupId || null,
      };
      await createMode.mutateAsync({
        ...payload,
        derived_from_test_record_ids: fixedDerivedFromTestRecordId ? [fixedDerivedFromTestRecordId] : [...derivedFrom],
        derived_from_intercept_entry_ids: fixedDerivedFromInterceptEntryId ? [fixedDerivedFromInterceptEntryId] : [],
      });
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
        <select value={functionGroupId} onChange={(e) => setFunctionGroupId(e.target.value)}>
          <option value="">— no Function Group —</option>
          {(functionGroups ?? []).map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
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
            checked={priRangeMatching}
            onChange={(e) => setPriRangeMatching(e.target.checked)}
          />
          PRI
        </label>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={pwRangeMatching}
            onChange={(e) => setPwRangeMatching(e.target.checked)}
          />
          PW
        </label>
      </div>

      {observedValueOptions && observedValueOptions.length > 0 && (
        <div className="form-row">
          <label className="wide-label">
            Pre-fill from observed values (optional)
            <span className="form-row">
              <select value={preFillFrom} onChange={(e) => setPreFillFrom(e.target.value)}>
                {observedValueOptions.map((o) => (
                  <option key={o.key} value={o.key}>
                    {o.label}
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
          <span className="param-row-label">PRI</span>
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
              title="Symmetric tolerance margin applied to the frame time to derive the engineered min/max"
              required
            />
          </label>
          <FrameTimeInput field={frameTime} />
        </div>
      )}

      {priType === "cw" && <p className="hint-text">CW: PRI is constant — no value to enter.</p>}
      {priType === "xlet" && <p className="hint-text">Xlet: no fields defined yet.</p>}

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

      <ConfirmationInputs
        quality={confirmationQuality}
        quantity={confirmationQuantity}
        onQualityChange={setConfirmationQuality}
        onQuantityChange={setConfirmationQuantity}
      />

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

      {!fixedDerivedFromTestRecordId && !fixedDerivedFromInterceptEntryId && !onStage && (
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
        <button type="submit" disabled={!onStage && createMode.isPending}>
          {onStage ? "Stage this Mode" : "Add Mode"}
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
