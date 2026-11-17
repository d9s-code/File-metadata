import { useEffect, useRef, useState } from "react";

/** How long after the last ↑/↓ click the new order is saved. */
const SETTLE_MS = 400;

const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/** Moving items up and down a list, quickly and safely: each click shows at
 * once and builds on the clicks before it (not on what the server last sent),
 * and only the final order is saved — once, after the clicks stop, never
 * two saves at the same time. Lists are told apart by a key, so one hook
 * serves several (e.g. milestones grouped by status).
 *
 * `orderOf(key, serverIds)` is the order to show; `move(key, serverIds, i, by)`
 * moves item i up (-1) or down (+1). */
export function useQueuedReorder(save: (key: string, ids: string[]) => Promise<unknown>, onError?: (err: unknown) => void) {
  const [local, setLocal] = useState<Record<string, string[]>>({});
  const localRef = useRef(local);
  localRef.current = local;
  const pending = useRef<Map<string, string[]>>(new Map());
  const timers = useRef<Map<string, number>>(new Map());
  const saving = useRef<Set<string>>(new Set());
  const saveRef = useRef(save);
  saveRef.current = save;
  const errorRef = useRef(onError);
  errorRef.current = onError;

  useEffect(
    () => () => {
      for (const t of timers.current.values()) window.clearTimeout(t);
    },
    [],
  );

  async function flush(key: string) {
    if (saving.current.has(key)) return; // sent when the save under way is done
    const ids = pending.current.get(key);
    if (!ids) return;
    pending.current.delete(key);
    saving.current.add(key);
    try {
      await saveRef.current(key, ids);
    } catch (err) {
      // Show what the server has again, and say why.
      pending.current.delete(key);
      setLocal((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      errorRef.current?.(err);
    } finally {
      saving.current.delete(key);
    }
    if (pending.current.has(key)) void flush(key);
  }

  /** The order to show: the clicked one until the server's matches it. */
  function orderOf(key: string, serverIds: string[]): string[] {
    const mine = local[key];
    if (!mine) return serverIds;
    // Items added or removed meanwhile: the server's list is the one to trust.
    if (mine.length !== serverIds.length || !serverIds.every((id) => mine.includes(id))) return serverIds;
    return mine;
  }

  // Once the server's order has caught up (and nothing's left to send), drop ours.
  function settle(key: string, serverIds: string[]) {
    const mine = localRef.current[key];
    if (mine && same(mine, serverIds) && !pending.current.has(key) && !saving.current.has(key)) {
      setLocal((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  }

  function move(key: string, serverIds: string[], index: number, by: -1 | 1) {
    const ids = [...orderOf(key, serverIds)];
    const j = index + by;
    if (j < 0 || j >= ids.length) return;
    [ids[index], ids[j]] = [ids[j], ids[index]];
    setLocal((prev) => ({ ...prev, [key]: ids }));
    pending.current.set(key, ids);
    window.clearTimeout(timers.current.get(key));
    timers.current.set(
      key,
      window.setTimeout(() => void flush(key), SETTLE_MS),
    );
  }

  return { orderOf, move, settle };
}
