import { useState, useEffect, type FormEvent } from "react";
import { useCreateEwGroup, useUpdateEwGroup } from "../../state/hooks/useEwGroups";
import { ApiRequestError } from "../../api/client";
import type { EwGroup } from "../../types/domain";

interface EwGroupFormProps {
  emitterId: string;
  initialData?: EwGroup | null;
  onClose?: () => void;
}

export function EwGroupForm({ emitterId, initialData, onClose }: EwGroupFormProps) {
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
      setScanMin("");
      setScanMax("");
      setScanDelta("");
      setThreatPriority("");
      setAgeout("");
    }
  }, [initialData]);

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
      <input placeholder="EW Group name" value={name} onChange={(e) => setName(e.target.value)} required />
      <input placeholder="Scan min" type="number" step="any" value={scanMin} onChange={(e) => setScanMin(e.target.value)} />
      <input placeholder="Scan max" type="number" step="any" value={scanMax} onChange={(e) => setScanMax(e.target.value)} />
      <input
        placeholder="Scan delta (±, optional)"
        type="number"
        step="any"
        min="0"
        value={scanDelta}
        onChange={(e) => setScanDelta(e.target.value)}
        title="Symmetric tolerance margin applied to the raw scan range to derive the engineered scan window"
      />
      <input
        placeholder="Threat priority"
        type="number"
        value={threatPriority}
        onChange={(e) => setThreatPriority(e.target.value)}
      />
      <input
        placeholder="Ageout (s)"
        type="number"
        step="any"
        min="0"
        value={ageout}
        onChange={(e) => setAgeout(e.target.value)}
        title="Descriptive reference value in seconds — no automated behavior tied to it"
      />
      <button type="submit" disabled={isPending}>
        {initialData ? "Update EW Group" : "Add EW Group"}
      </button>
      {error && <div className="error-text">{error}</div>}
    </form>
  );
}
