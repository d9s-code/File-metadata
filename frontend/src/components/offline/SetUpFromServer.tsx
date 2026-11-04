import { useState, type FormEvent } from "react";
import { ApiRequestError } from "../../api/client";
import { offlineApi } from "../../api/offline";

/** The standalone app's first start: nothing on this PC yet, so fetch it all
 * from the server — people then sign in here as they do there. */
export function SetUpFromServer({ onDone }: { onDone: (rows: number) => void }) {
  const [serverUrl, setServerUrl] = useState("https://");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const { rows } = await offlineApi.setup({ server_url: serverUrl.trim(), username, password });
      onDone(rows);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Couldn't fetch from the server");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card login-card" onSubmit={handleSubmit}>
      <h1>Set up this PC</h1>
      <p className="hint-text">
        This is the offline version of the app, and there&apos;s nothing on this PC yet. Fetch a copy of everything
        from the server while you&apos;re connected to it — you can then work here without a connection, and sync your
        changes back when you&apos;re connected again. Setting up and syncing need an Admin.
      </p>
      <label>
        Server address
        <input value={serverUrl} onChange={(e) => setServerUrl(e.target.value)} placeholder="https://prs.app" required autoFocus />
      </label>
      <label>
        Your username on the server (an Admin)
        <input value={username} onChange={(e) => setUsername(e.target.value)} required />
      </label>
      <label>
        Password
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      </label>
      {error && <div className="error-text">{error}</div>}
      <button type="submit" disabled={busy}>
        {busy ? "Fetching…" : "Fetch from the server"}
      </button>
    </form>
  );
}
