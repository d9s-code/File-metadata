import { useState, type FormEvent } from "react";
import { useCreateMode } from "../../state/hooks/useModes";
import { ApiRequestError } from "../../api/client";
import type { EwGroup, PriType, Source } from "../../types/domain";

const PRI_TYPES: PriType[] = ["fixed", "stagger", "cw", "xlet"];

export function ModeForm({
  emitterId,
  ewGroups,
  sources,
  defaultEwGroupId,
}: {
  emitterId: string;
  ewGroups: EwGroup[];
  sources: Source[];
  defaultEwGroupId?: string;
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
  const [error, setError] = useState<string | null>(null);

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
    try {
      await createMode.mutateAsync({
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

      <div className="form-row">
        <label>
          RF min (MHz)
          <input type="number" step="any" value={rfMin} onChange={(e) => setRfMin(e.target.value)} required />
        </label>
        <label>
          RF max (MHz)
          <input type="number" step="any" value={rfMax} onChange={(e) => setRfMax(e.target.value)} required />
        </label>
        <label>
          RF delta (±MHz)
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
        <label>
          PW min (µs)
          <input type="number" step="any" value={pwMin} onChange={(e) => setPwMin(e.target.value)} required />
        </label>
        <label>
          PW max (µs)
          <input type="number" step="any" value={pwMax} onChange={(e) => setPwMax(e.target.value)} required />
        </label>
        <label>
          PW delta (±µs)
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
        <div className="form-row">
          <label>
            PRI min (µs)
            <input type="number" step="any" value={priMin} onChange={(e) => setPriMin(e.target.value)} required />
          </label>
          <label>
            PRI max (µs)
            <input type="number" step="any" value={priMax} onChange={(e) => setPriMax(e.target.value)} required />
          </label>
          <label>
            PRI delta (±µs)
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
            Jitter min (µs)
            <input type="number" step="any" value={jitterMin} onChange={(e) => setJitterMin(e.target.value)} required />
          </label>
          <label>
            Jitter max (µs)
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
            rows={2}
          />
        </label>
      </div>

      <button type="submit" disabled={createMode.isPending}>
        Add Mode
      </button>
      {error && <div className="error-text">{error}</div>}
    </form>
  );
}
