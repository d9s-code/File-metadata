import { useState } from "react";
import { usePlatforms } from "../../state/hooks/usePlatforms";
import { usePlatformVersions } from "../../state/hooks/usePlatformVersions";
import { usePinPlatform } from "../../state/hooks/useMdfs";
import { ApiRequestError } from "../../api/client";

export function PlatformVersionPicker({ mdfId }: { mdfId: string }) {
  const { data: platforms } = usePlatforms();
  const [platformId, setPlatformId] = useState("");
  const { data: versions } = usePlatformVersions(platformId);
  const [versionNumber, setVersionNumber] = useState<number | "">("");
  const pinPlatform = usePinPlatform(mdfId);
  const [error, setError] = useState<string | null>(null);

  const selectedVersion = versions?.find((v) => v.version_number === versionNumber);

  async function handlePin() {
    setError(null);
    if (!selectedVersion) {
      setError("Choose a platform and a committed version first.");
      return;
    }
    try {
      await pinPlatform.mutateAsync({ platformId, platformVersionId: selectedVersion.id });
      setPlatformId("");
      setVersionNumber("");
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Failed to pin platform");
    }
  }

  return (
    <div className="card inline-form">
      <select
        value={platformId}
        onChange={(e) => {
          setPlatformId(e.target.value);
          setVersionNumber("");
        }}
      >
        <option value="">Choose platform…</option>
        {platforms?.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <select
        value={versionNumber}
        onChange={(e) => setVersionNumber(e.target.value ? Number(e.target.value) : "")}
        disabled={!platformId}
      >
        <option value="">
          {platformId && versions?.length === 0 ? "No committed versions — commit one first" : "Choose version…"}
        </option>
        {versions?.map((v) => (
          <option key={v.id} value={v.version_number}>
            v{v.version_number} {v.change_summary ? `— ${v.change_summary}` : ""}
          </option>
        ))}
      </select>
      <button onClick={() => void handlePin()} disabled={pinPlatform.isPending || !selectedVersion}>
        Pin Platform
      </button>
      {error && <div className="error-text">{error}</div>}
    </div>
  );
}
