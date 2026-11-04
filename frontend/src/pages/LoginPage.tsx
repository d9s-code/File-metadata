import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { ApiRequestError } from "../api/client";
import { STANDALONE, offlineApi, type OfflineStatus } from "../api/offline";
import { SetUpFromServer } from "../components/offline/SetUpFromServer";

export function LoginPage() {
  const { login, sessionExpired } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const next = searchParams.get("next");
  // Only same-app paths: "//host" would be protocol-relative, i.e. off-site.
  const redirectTo = next && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // The offline app before its first fetch has no one to sign in as.
  // Fetched directly, not through the query cache: signing out clears that cache.
  const [offline, setOffline] = useState<OfflineStatus | null>(null);
  // If it can't be asked, the sign-in form is the best guess.
  const refetch = () =>
    offlineApi.status().then(setOffline, () => setOffline({ set_up: true } as OfflineStatus));
  useEffect(() => {
    if (STANDALONE) void refetch();
  }, []);
  const [fetchedRows, setFetchedRows] = useState<number | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(username, password);
      navigate(redirectTo, { replace: true });
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Login failed");
    } finally {
      setSubmitting(false);
    }
  }

  if (STANDALONE && !offline) return <div className="centered-page" />;
  if (STANDALONE && offline && !offline.set_up) {
    return (
      <div className="centered-page">
        <SetUpFromServer
          onDone={(rows) => {
            setFetchedRows(rows);
            void refetch();
          }}
        />
      </div>
    );
  }

  return (
    <div className="centered-page">
      <form className="card login-card" onSubmit={handleSubmit}>
        <h1>RF Emitter Profile Manager</h1>
        {STANDALONE && <div className="hint-text">Offline version, on this PC — sign in as you do on the server.</div>}
        {fetchedRows != null && (
          <div className="success-text">Fetched {fetchedRows.toLocaleString()} rows from the server.</div>
        )}
        {sessionExpired && <div className="hint-text">Your session expired — sign in again to continue.</div>}
        <label>
          Username
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus required />
        </label>
        <label>
          Password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {error && <div className="error-text">{error}</div>}
        <button type="submit" disabled={submitting}>
          {submitting ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
