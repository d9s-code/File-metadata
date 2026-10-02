/** An unfinished CSV import, kept in this browser so grouping work survives
 * leaving the page — the back button, a link, a refresh or a crash. The file
 * itself is kept too (it can be tens of MB), so IndexedDB rather than
 * localStorage. Every call fails quietly: without storage there's simply no
 * draft to offer. */
import type { ReportGroup } from "./interceptGroups";

export interface ImportDraft {
  fileName: string;
  /** The file's text — parsed again on resume, so line numbers match the groups. */
  text: string;
  groups: ReportGroup[];
  destination: {
    emitterId: string;
    target: "new" | "existing";
    interceptId: string;
    name: string;
    recordedOn: string;
    collectedBy: string;
    description: string;
  };
  savedAt: number;
}

const DB_NAME = "prs-import-drafts";
const STORE = "drafts";
const KEY = "intercept-csv";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function run<T>(mode: IDBTransactionMode, act: (store: IDBObjectStore) => IDBRequest): Promise<T | null> {
  if (typeof indexedDB === "undefined") return null;
  try {
    const db = await openDb();
    return await new Promise<T | null>((resolve) => {
      const tx = db.transaction(STORE, mode);
      const request = act(tx.objectStore(STORE));
      tx.oncomplete = () => {
        db.close();
        resolve((request.result as T) ?? null);
      };
      tx.onerror = tx.onabort = () => {
        db.close();
        resolve(null);
      };
    });
  } catch {
    return null;
  }
}

export const loadImportDraft = () => run<ImportDraft>("readonly", (s) => s.get(KEY));
export const saveImportDraft = (draft: ImportDraft) => run("readwrite", (s) => s.put(draft, KEY));
export const clearImportDraft = () => run("readwrite", (s) => s.delete(KEY));

/** Regrouping a saved Intercept's reports, in progress. Only offered back
 * while the Intercept's grouping is still the version it started from. */
export interface RegroupDraft {
  groupingVersion: number;
  /** Groups as lists of report ids — stable, unlike the page's line numbers. */
  groups: { reportIds: string[]; excluded: boolean }[];
  savedAt: number;
}

const regroupKey = (interceptId: string) => `regroup-${interceptId}`;
export const loadRegroupDraft = (interceptId: string) =>
  run<RegroupDraft>("readonly", (s) => s.get(regroupKey(interceptId)));
export const saveRegroupDraft = (interceptId: string, draft: RegroupDraft) =>
  run("readwrite", (s) => s.put(draft, regroupKey(interceptId)));
export const clearRegroupDraft = (interceptId: string) =>
  run("readwrite", (s) => s.delete(regroupKey(interceptId)));
