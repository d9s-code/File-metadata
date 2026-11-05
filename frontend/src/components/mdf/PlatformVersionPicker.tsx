import { useState } from "react";
import { usePlatforms } from "../../state/hooks/usePlatforms";
import { usePlatformVersions } from "../../state/hooks/usePlatformVersions";
import { usePinPlatform } from "../../state/hooks/useMdfs";
import { ApiRequestError } from "../../api/client";
import { formatDate } from "../common/dates";

/** Pick a Platform and one of its saved versions — the latest unless you
 * choose another. */
export function PlatformVersionPicker({ mdfId, onDone }: { mdfId: string; onDone?: () => void }) {
  const { data: platforms } = usePlatforms();
  const [platformId, setPlatformId] = useState("");
  const { data: versions } = usePlatformVersions(platformId);
  // "" = the latest saved version.
  const [versionNumber, setVersionNumber] = useState<number | "">("");
  const pinPlatform = usePinPlatform(mdfId);
  const [error, setError] = useState<string | null>(null);

  const newestFirst = [...(versions ?? [])].reverse();
  const selectedVersion = versionNumber === "" ? newestFirst[0] : versions?.find((v) => v.version_number === versionNumber);
  const noVersions = !!platformId && versions?.length === 0;

  async function handlePin() {
    setError(null);
    if (!selectedVersion) {
      setError("Choose a Platform with a saved version first.");
      return;
    }
    try {
      await pinPlatform.mutateAsync({ platformId, platformVersionId: selectedVersion.id });
      setPlatformId("");
      setVersionNumber("");
      onDone?.();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Couldn't pin the Platform.");
    }
  }

  const emitters = (n: number | undefined) => (n == null ? "" : ` · ${n} Emitter${n === 1 ? "" : "s"}`);

  return (
    <div className={onDone ? "rename-form" : "card rename-form"}>
      <label>
        Platform
        <select
          value={platformId}
          onChange={(e) => {
            setPlatformId(e.target.value);
            setVersionNumber("");
          }}
        >
          <option value="">— Pick the Platform —</option>
          {platforms?.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Version
        <select
          value={versionNumber}
          onChange={(e) => setVersionNumber(e.target.value ? Number(e.target.value) : "")}
          disabled={!platformId || noVersions}
        >
          {noVersions ? (
            <option value="">No saved version — save one on the Platform first</option>
          ) : (
            <option value="">
              The latest saved{newestFirst[0] ? ` (v${newestFirst[0].version_label ?? newestFirst[0].version_number})` : ""}
            </option>
          )}
          {newestFirst.map((v) => (
            <option key={v.id} value={v.version_number}>
              v{v.version_label ?? v.version_number} · {formatDate(v.created_at)}
              {emitters(v.emitter_count)}
              {v.change_summary ? ` — ${v.change_summary}` : ""}
            </option>
          ))}
        </select>
      </label>
      {selectedVersion && selectedVersion.emitter_count === 0 && (
        <p className="hint-text">That version pins no Emitter.</p>
      )}
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      <div className="modal-actions">
        {onDone && (
          <button type="button" className="button secondary" onClick={onDone}>
            Cancel
          </button>
        )}
        <button
          type="button"
          className="button primary"
          onClick={() => void handlePin()}
          disabled={pinPlatform.isPending || !selectedVersion}
        >
          {pinPlatform.isPending ? "Pinning…" : "Pin Platform"}
        </button>
      </div>
    </div>
  );
}
