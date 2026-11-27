import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { authApi } from "../api/auth";
import { useQueryClient } from "@tanstack/react-query";
import { ApiRequestError, SESSION_EXPIRED_EVENT } from "../api/client";
import type { User, UserPreferences } from "../types/domain";
import { clearCacheCopies, keepCacheCopy, restoreCacheCopy } from "../state/persistCache";

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  /** True once a request has come back 401 mid-session, until the next login. */
  sessionExpired: boolean;
  /** Change your own settings; the user (and what's shown) updates at once. */
  updatePreferences: (changes: Partial<UserPreferences>) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessionExpired, setSessionExpired] = useState(false);
  const queryClient = useQueryClient();

  useEffect(() => {
    function handleExpired() {
      setUser(null);
      setSessionExpired(true);
      queryClient.clear();
    }
    window.addEventListener(SESSION_EXPIRED_EVENT, handleExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, handleExpired);
  }, [queryClient]);

  // Signed in: the data last seen here, at once (then refreshed), and kept as it changes.
  const userId = user?.id;
  const stopKeeping = useRef<() => void>(() => undefined);
  useEffect(() => {
    if (userId === undefined) return;
    const stop = keepCacheCopy(queryClient, userId);
    stopKeeping.current = stop;
    return stop;
  }, [queryClient, userId]);

  useEffect(() => {
    authApi
      .me()
      .then(async (me) => {
        await restoreCacheCopy(queryClient, me.id);
        setUser(me);
      })
      .catch((err) => {
        if (!(err instanceof ApiRequestError && err.status === 401)) {
          console.error("Failed to load current user", err);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const loggedInUser = await authApi.login(username, password);
    // Someone else's data is never shown: whatever was in memory goes first.
    queryClient.clear();
    await restoreCacheCopy(queryClient, loggedInUser.id);
    setSessionExpired(false);
    setUser(loggedInUser);
  }, [queryClient]);

  const logout = useCallback(async () => {
    const id = user?.id;
    await authApi.logout();
    // Signed out: nothing of theirs stays — in memory or in this browser.
    stopKeeping.current();
    queryClient.clear();
    if (id) await clearCacheCopies(id);
    setUser(null);
  }, [queryClient, user]);

  const updatePreferences = useCallback(async (changes: Partial<UserPreferences>) => {
    setUser(await authApi.updatePreferences(changes));
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, sessionExpired, updatePreferences }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
