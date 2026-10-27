import { useState, type FormEvent } from "react";
import { AdminNav } from "../components/common/AdminNav";
import { LoadingState } from "../components/common/LoadingState";
import { num } from "../components/dwells/DwellChart";
import { ApiRequestError } from "../api/client";
import { useAppSettings, useUpdateAppSettings } from "../state/hooks/useDwells";
import { useAiStatus, useSyncDocumentation } from "../state/hooks/useAmbiguity";
import { relativeTime } from "../components/common/backupFormat";
import { ChatContextSetting } from "../components/ai/ChatContextSetting";
import { DocumentationKinds } from "../components/ai/DocumentationKinds";

/** App-wide settings: the dwell charts' default bandwidth, and the AI's
 * copy of the documentation. */
export function AdminSettingsPage() {
  const { data: settings, isLoading } = useAppSettings();
  if (isLoading || !settings) return <LoadingState label="Loading settings…" />;
  return (
    <div className="page">
      <h1>Admin</h1>
      <AdminNav />
      <BandwidthSetting current={settings.dwell_bandwidth_mhz} />
      <ChatContextSetting current={settings.ai_chat_max_context_tokens} />
      <DocumentationSetting />
    </div>
  );
}

/** The copy of the Outline documentation the AI is given as background:
 * what it is, how fresh, and Sync now. */
function DocumentationSetting() {
  const status = useAiStatus();
  const sync = useSyncDocumentation();
  const doc = status.data?.documentation;
  return (
    <section className="card">
      <h4>AI documentation</h4>
      {!doc ? (
        <p className="hint-text">
          No documentation is set up. To give the AI chat and explanations pages from Outline as background, set{" "}
          <code>OUTLINE_URL</code>, <code>OUTLINE_API_TOKEN</code> and <code>OUTLINE_ROOT</code> (or{" "}
          <code>OUTLINE_COLLECTION</code>) on the backend.
        </p>
      ) : (
        <>
          <p>
            {doc.synced_at ? (
              <>
                {doc.label}: {doc.sections} sections (
                {doc.tokens < 1000 ? `${doc.tokens} tokens` : `about ${Math.round(doc.tokens / 1000)}k tokens`}), copied{" "}
                {relativeTime(doc.synced_at)}.
              </>
            ) : (
              <>{doc.label}: not copied yet — it&apos;s copied on the first question, or now.</>
            )}
          </p>
          {doc.error && (
            <p className="error-text">
              Last refresh failed{doc.tried_at ? ` ${relativeTime(doc.tried_at)}` : ""}: {doc.error}
            </p>
          )}
          <div className="form-row">
            <button type="button" className="button primary" disabled={sync.isPending} onClick={() => sync.mutate()}>
              {sync.isPending ? "Syncing…" : "Sync now"}
            </button>
          </div>
          <p className="hint-text">
            The AI chat and the ambiguity explanations use this copy; it&apos;s refreshed on the next question once
            it&apos;s more than an hour old. Sync now after changing pages in Outline.
          </p>
          {sync.isSuccess && <p className="success-text">Synced.</p>}
          {sync.isError && (
            <p className="error-text" role="alert">
              {sync.error instanceof ApiRequestError ? sync.error.message : "Couldn't sync."}
            </p>
          )}
          <DocumentationKinds />
        </>
      )}
    </section>
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
      <h4>Dwell charts</h4>
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
        How wide each dwell is drawn around its frequency in the Dwells charts, for every Strategy that doesn&apos;t set
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
