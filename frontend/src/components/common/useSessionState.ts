import { useEffect, useState } from "react";

type Where = "session" | "local";

function storage(where: Where): Storage {
  return where === "session" ? sessionStorage : localStorage;
}

function read<T>(where: Where, key: string, initial: T | (() => T)): T {
  try {
    const raw = storage(where).getItem(`${where}:${key}`);
    if (raw !== null) return JSON.parse(raw) as T;
  } catch {
    // Blocked or unreadable storage: start from the default.
  }
  return typeof initial === "function" ? (initial as () => T)() : initial;
}

function useStoredState<T>(where: Where, key: string, initial: T | (() => T)) {
  const [state, setState] = useState(() => ({ key, value: read(where, key, initial) }));
  // Another item (a new key) while mounted: its own remembered value.
  const current = state.key === key ? state.value : read(where, key, initial);
  if (state.key !== key) setState({ key, value: current });

  useEffect(() => {
    try {
      storage(where).setItem(`${where}:${key}`, JSON.stringify(current));
    } catch {
      // Not remembered, but still applied.
    }
  }, [where, key, current]);

  const setValue = (next: T | ((prev: T) => T)) =>
    setState((s) => ({
      key: s.key,
      value: typeof next === "function" ? (next as (prev: T) => T)(s.value) : next,
    }));
  return [current, setValue] as const;
}

/** useState that's kept for this browser tab's session — a filter or sort
 * survives a reload and going to another page and back, and is forgotten
 * when the tab closes. `key` names it (include an id when it's per item,
 * e.g. one Emitter's Modes filters); a new key reads that key's value. */
export function useSessionState<T>(key: string, initial: T | (() => T)) {
  return useStoredState("session", key, initial);
}

/** Like useSessionState, but remembered in this browser until changed — for
 * a view someone sets up once, like which statuses a list leaves out. */
export function useLocalState<T>(key: string, initial: T | (() => T)) {
  return useStoredState("local", key, initial);
}
