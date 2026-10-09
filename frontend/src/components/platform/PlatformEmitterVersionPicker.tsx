import { useState } from "react";
import { useEmitters } from "../../state/hooks/useEmitters";
import { useEmitterVersions } from "../../state/hooks/useEmitterVersions";
import { usePinEmitter } from "../../state/hooks/usePlatforms";
import { ApiRequestError } from "../../api/client";

export function PlatformEmitterVersionPicker({ platformId }: { platformId: string }) {
  const { data: emitters } = useEmitters();
  const [emitterId, setEmitterId] = useState("");
  const { data: versions } = useEmitterVersions(emitterId);
  const [versionNumber, setVersionNumber] = useState<number | "">("");
  const pinEmitter = usePinEmitter(platformId);
  const [error, setError] = useState<string | null>(null);

  const selectedVersion = versions?.find((v) => v.version_number === versionNumber);
  // Designation first — that's how they're looked for — then the name.
  const choices = [...(emitters ?? [])].sort(
    (a, b) =>
      (a.designation ?? "\uffff").localeCompare(b.designation ?? "\uffff", undefined, { numeric: true }) ||
      a.name.localeCompare(b.name),
  );

  async function handlePin() {
    setError(null);
    if (!selectedVersion) {
      setError("Choose an Emitter and a saved version first.");
      return;
    }
    try {
      await pinEmitter.mutateAsync({ emitterId, emitterVersionId: selectedVersion.id });
      setEmitterId("");
      setVersionNumber("");
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Failed to pin emitter");
    }
  }

  return (
    <div className="card inline-form">
      <select
        value={emitterId}
        onChange={(e) => {
          setEmitterId(e.target.value);
          setVersionNumber("");
        }}
      >
        <option value="">Choose emitter (designation — name)…</option>
        {choices.map((e) => (
          <option key={e.id} value={e.id}>
            {e.designation ? `${e.designation} — ${e.name}` : e.name}
          </option>
        ))}
      </select>
      <select
        value={versionNumber}
        onChange={(e) => setVersionNumber(e.target.value ? Number(e.target.value) : "")}
        disabled={!emitterId}
      >
        <option value="">
          {emitterId && versions?.length === 0 ? "No saved versions — save one on the Emitter first" : "Choose version…"}
        </option>
        {versions?.map((v) => (
          <option key={v.id} value={v.version_number}>
            v{v.version_number} {v.change_summary ? `— ${v.change_summary}` : ""}
          </option>
        ))}
      </select>
      <button onClick={() => void handlePin()} disabled={pinEmitter.isPending || !selectedVersion}>
        Pin Emitter
      </button>
      {error && <div className="error-text">{error}</div>}
    </div>
  );
}
