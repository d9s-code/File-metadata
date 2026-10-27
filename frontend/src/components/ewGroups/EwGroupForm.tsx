import { useState, useEffect, type FormEvent } from "react";
import { useCreateEwGroup, useUpdateEwGroup } from "../../state/hooks/useEwGroups";
import { ApiRequestError } from "../../api/client";
import type { EwGroup } from "../../types/domain";

interface EwGroupFormProps {
  emitterId: string;
  initialData?: EwGroup | null;
  /** Values to start a new EW Group with (e.g. the suggested scan range). */
  prefill?: { scan_min: number; scan_max: number } | null;
  onClose?: () => void;
}

export function EwGroupForm({ emitterId, initialData, prefill, onClose }: EwGroupFormProps) {
  const createEwGroup = useCreateEwGroup(emitterId);
  const updateEwGroup = useUpdateEwGroup(emitterId);

  const [name, setName] = useState("");
  const [scanMin, setScanMin] = useState("");
  const [scanMax, setScanMax] = useState("");
  const [scanDelta, setScanDelta] = useState("");
  const [threatPriority, setThreatPriority] = useState("");
  const [ageout, setAgeout] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initialData) {
      setName(initialData.name);
      setScanMin(initialData.scan_min?.toString() ?? "");
      setScanMax(initialData.scan_max?.toString() ?? "");
      setScanDelta(initialData.scan_delta?.toString() ?? "");
      setThreatPriority(initialData.threat_priority?.toString() ?? "");
      setAgeout(initialData.ageout?.toString() ?? "");
    } else {
      setName("");
      setScanMin(prefill ? String(prefill.scan_min) : "");
      setScanMax(prefill ? String(prefill.scan_max) : "");
      setScanDelta("");
      setThreatPriority("");
      setAgeout("");
    }
  }, [initialData, prefill]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const payload = {
      name,
      scan_min: scanMin ? Number(scanMin) : null,
      scan_max: scanMax ? Number(scanMax) : null,
      scan_delta: scanDelta ? Number(scanDelta) : null,
      threat_priority: threatPriority ? Number(threatPriority) : null,
      ageout: ageout ? Number(ageout) : null,
    };

    try {
      if (initialData) {
        await updateEwGroup.mutateAsync({ ewGroupId: initialData.id, input: payload });
      } else {
        await createEwGroup.mutateAsync(payload);
      }
      
      if (onClose) {
        onClose();
      } else {
        setName("");
        setScanMin("");
        setScanMax("");
        setScanDelta("");
        setThreatPriority("");
        setAgeout("");
      }
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Operation failed");
    }
  }

  const isPending = createEwGroup.isPending || updateEwGroup.isPending;

  return (
    <form className="card inline-form" onSubmit={handleSubmit}>
      {initialData && <h4 className="inline-form-title">Editing EW Group &ldquo;{initialData.name}&rdquo;</h4>}
      <label className="inline-field">
        Name
        <input placeholder="EW Group name" value={name} onChange={(e) => setName(e.target.value)} required />
      </label>
      <label className="inline-field">
        Scan min
        <input placeholder="Scan min" type="number" step="any" value={scanMin} onChange={(e) => setScanMin(e.target.value)} />
      </label>
      <label className="inline-field">
        Scan max
        <input placeholder="Scan max" type="number" step="any" value={scanMax} onChange={(e) => setScanMax(e.target.value)} />
      </label>
      <label className="inline-field">
        Scan ± delta
        <input
          placeholder="Scan delta (±, optional)"
          type="number"
          step="any"
          min="0"
          value={scanDelta}
          onChange={(e) => setScanDelta(e.target.value)}
          title="Symmetric tolerance delta applied to the raw scan range to derive the engineered scan window"
        />
      </label>
      <label className="inline-field">
        Threat priority
        <input
          placeholder="Threat priority"
          type="number"
          value={threatPriority}
          onChange={(e) => setThreatPriority(e.target.value)}
        />
      </label>
      <label className="inline-field">
        Ageout (s)
        <input
          placeholder="Ageout (s)"
          type="number"
          step="any"
          min="0"
          value={ageout}
          onChange={(e) => setAgeout(e.target.value)}
          title="Descriptive reference value in seconds — no automated behavior tied to it"
        />
      </label>
      <button type="submit" disabled={isPending}>
        {initialData ? "Save" : "Add EW Group"}
      </button>
      {onClose && (
        <button type="button" className="icon-button" onClick={() => onClose()}>
          Cancel
        </button>
      )}
      {error && <div className="error-text">{error}</div>}
    </form>
  );
}
