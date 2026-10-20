import { useEffect, useState } from "react";

const PREFIX = "session:";

function read<T>(key: string, initial: T | (() => T)): T {
  try {
    const raw = sessionStorage.getItem(PREFIX + key);
    if (raw !== null) return JSON.parse(raw) as T;
  } catch {
    // Blocked or unreadable storage: start from the default.
  }
  return typeof initial === "function" ? (initial as () => T)() : initial;
}

/** useState that's kept for this browser tab's session — a filter or sort
 * survives a reload and going to another page and back, and is forgotten
 * when the tab closes. `key` names it (include an id when it's per item,
 * e.g. one Emitter's Modes filters); a new key reads that key's value. */
export function useSessionState<T>(key: string, initial: T | (() => T)) {
  const [state, setState] = useState(() => ({ key, value: read(key, initial) }));
  // Another item (a new key) while mounted: its own remembered value.
  const current = state.key === key ? state.value : read(key, initial);
  if (state.key !== key) setState({ key, value: current });

  useEffect(() => {
    try {
      sessionStorage.setItem(PREFIX + key, JSON.stringify(current));
    } catch {
      // Not remembered, but still applied.
    }
  }, [key, current]);

  const setValue = (next: T | ((prev: T) => T)) =>
    setState((s) => ({
      key: s.key,
      value: typeof next === "function" ? (next as (prev: T) => T)(s.value) : next,
    }));
  return [current, setValue] as const;
}
