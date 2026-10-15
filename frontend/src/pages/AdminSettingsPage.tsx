import { useState, type FormEvent } from "react";
import { AdminNav } from "../components/common/AdminNav";
import { LoadingState } from "../components/common/LoadingState";
import { num } from "../components/dwells/DwellChart";
import { ApiRequestError } from "../api/client";
import { useAppSettings, useUpdateAppSettings } from "../state/hooks/useDwells";

/** App-wide settings: for now, the dwell charts' default bandwidth. */
export function AdminSettingsPage() {
  const { data: settings, isLoading } = useAppSettings();
  if (isLoading || !settings) return <LoadingState label="Loading settings…" />;
  return (
    <div className="page">
      <h1>Admin</h1>
      <AdminNav />
      <BandwidthSetting current={settings.dwell_bandwidth_mhz} />
    </div>
  );
}

function BandwidthSetting({ current }: { current: number }) {
  const update = useUpdateAppSettings();
  const [text, setText] = useState(num(current));
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setMessage(null);
    setError(null);
    const value = Number(text);
    if (!(value > 0)) return setError("The bandwidth must be above 0 MHz.");
    try {
      await update.mutateAsync({ dwell_bandwidth_mhz: value });
      setMessage("Saved.");
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Couldn't save it.");
    }
  }

  return (
    <form className="card" onSubmit={handleSubmit}>
      <h3>Dwell charts</h3>
      <div className="form-row">
        <label>
          Default bandwidth (MHz)
          <input type="number" step="any" min="0" value={text} onChange={(e) => setText(e.target.value)} />
        </label>
        <button type="submit" className="button primary" disabled={update.isPending || Number(text) === current}>
          Save
        </button>
      </div>
      <p className="hint-text">
        How wide each dwell is drawn around its frequency in the Dwells charts, for every dwell file that doesn&apos;t set
        its own.
      </p>
      {message && <p className="success-text">{message}</p>}
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
