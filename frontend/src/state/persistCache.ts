/** A copy of what's been fetched, kept in this browser (IndexedDB) per user,
 * so the app opens with the data you last saw at once — then refreshes it
 * in the background. Signing out removes it; a new build of the app starts
 * afresh (the data's shape may have changed); it can be turned off in
 * Settings, e.g. on a shared computer. Everything here fails quietly: no
 * storage just means no copy. */
import { dehydrate, hydrate, type QueryClient } from "@tanstack/react-query";

const DB_NAME = "prs-cache";
const STORE = "queries";
const OFF_KEY = "cache-copy-off";
/** A copy older than this isn't worth showing. */
const MAX_AGE_MS = 7 * 24 * 3600 * 1000;
const SAVE_AFTER_MS = 2000;
/** Changes too often, or too big, to be worth keeping. */
const NOT_KEPT = new Set(["auditLog", "planComments"]);

interface Saved {
  build: string;
  savedAt: number;
  state: ReturnType<typeof dehydrate>;
}

export function cacheCopyEnabled(): boolean {
  try {
    return localStorage.getItem(OFF_KEY) !== "1";
  } catch {
    return false;
  }
}

export function setCacheCopyEnabled(on: boolean) {
  try {
    if (on) localStorage.removeItem(OFF_KEY);
    else localStorage.setItem(OFF_KEY, "1");
  } catch {
    // Not kept; fine.
  }
  if (!on) void clearCacheCopies();
}

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function withStore<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, mode);
      const req = run(tx.objectStore(STORE));
      tx.oncomplete = () => {
        db.close();
        resolve(req ? (req.result as T) : null);
      };
      tx.onerror = tx.onabort = () => {
        db.close();
        resolve(null);
      };
    } catch {
      db.close();
      resolve(null);
    }
  });
}

/** Puts the user's copy (if any, from this build, not too old) into the cache. Never takes longer than `timeoutMs`. */
export async function restoreCacheCopy(qc: QueryClient, userId: string, timeoutMs = 500): Promise<void> {
  if (!cacheCopyEnabled()) return;
  const read = withStore<Saved | undefined>("readonly", (s) => s.get(userId));
  const saved = await Promise.race([read, new Promise<null>((r) => setTimeout(() => r(null), timeoutMs))]);
  if (!saved || saved.build !== __BUILD_ID__ || Date.now() - saved.savedAt > MAX_AGE_MS) return;
  try {
    hydrate(qc, saved.state);
  } catch {
    // A copy that doesn't fit is simply not used.
  }
}

/** Keeps the user's copy up to date while they work; returns a stop function. */
export function keepCacheCopy(qc: QueryClient, userId: string): () => void {
  if (!cacheCopyEnabled()) return () => undefined;
  let timer: number | undefined;
  const save = () => {
    window.clearTimeout(timer);
    if (!cacheCopyEnabled()) return;
    const state = dehydrate(qc, {
      shouldDehydrateQuery: (q) =>
        q.state.status === "success" && q.meta?.persist !== false && !NOT_KEPT.has(String(q.queryKey[0])),
    });
    const value: Saved = { build: __BUILD_ID__, savedAt: Date.now(), state };
    void withStore("readwrite", (s) => {
      s.put(value, userId);
    });
  };
  const later = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(save, SAVE_AFTER_MS);
  };
  const unsubscribe = qc.getQueryCache().subscribe((e) => {
    if (e.type === "updated" && e.action.type === "success") later();
  });
  const onHide = () => {
    if (document.visibilityState === "hidden") save();
  };
  document.addEventListener("visibilitychange", onHide);
  return () => {
    unsubscribe();
    window.clearTimeout(timer);
    document.removeEventListener("visibilitychange", onHide);
  };
}

/** Removes the copy — one user's, or everyone's in this browser. */
export async function clearCacheCopies(userId?: string): Promise<void> {
  await withStore("readwrite", (s) => {
    if (userId) s.delete(userId);
    else s.clear();
  });
}
