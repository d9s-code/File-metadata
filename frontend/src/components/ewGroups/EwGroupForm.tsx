import { useState, type FormEvent } from "react";
import { useCreateEwGroup } from "../../state/hooks/useEwGroups";
import { ApiRequestError } from "../../api/client";

export function EwGroupForm({ emitterId }: { emitterId: string }) {
  const createEwGroup = useCreateEwGroup(emitterId);
  const [name, setName] = useState("");
  const [scanMin, setScanMin] = useState("");
  const [scanMax, setScanMax] = useState("");
  const [scanDelta, setScanDelta] = useState("");
  const [threatPriority, setThreatPriority] = useState("");
  const [ageout, setAgeout] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await createEwGroup.mutateAsync({
        name,
        scan_min: scanMin ? Number(scanMin) : null,
        scan_max: scanMax ? Number(scanMax) : null,
        scan_delta: scanDelta ? Number(scanDelta) : null,
        threat_priority: threatPriority ? Number(threatPriority) : null,
        ageout: ageout ? Number(ageout) : null,
      });
      setName("");
      setScanMin("");
      setScanMax("");
      setScanDelta("");
      setThreatPriority("");
      setAgeout("");
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Failed to create EW Group");
    }
  }

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
      <button type="submit" disabled={createEwGroup.isPending}>
        Add EW Group
      </button>
      {error && <div className="error-text">{error}</div>}
    </form>
  );
}
