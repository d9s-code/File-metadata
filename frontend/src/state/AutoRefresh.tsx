import { useEffect } from "react";
import { useQueryClient, type Query } from "@tanstack/react-query";
import { DATA_CHANGED_EVENT } from "../api/client";

/** How long to wait after a change before refreshing, so a burst of saves
 * (a batch edit, a loop of updates) refreshes once. */
const SETTLE_MS = 200;
const CHANNEL = "app-data-changed";

/** A query that would lose someone's work if it refetched under them opts
 * out with `meta: { autoRefresh: false }`. */
const refreshable = (q: Query) => q.meta?.autoRefresh !== false;

/** Keeps every page current: after anything changes data — here, or in
 * another tab of the app — what's on screen refetches, and what isn't is
 * marked stale so it's fetched fresh when shown. No page has to know which
 * other pages a change touches (e.g. new Elements and Element coverage). */
export function AutoRefresh() {
  const queryClient = useQueryClient();
  useEffect(() => {
    let timer: number | undefined;
    const refresh = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        void queryClient.invalidateQueries({ predicate: refreshable });
      }, SETTLE_MS);
    };
    const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(CHANNEL);
    const onLocal = () => {
      refresh();
      channel?.postMessage("changed");
    };
    window.addEventListener(DATA_CHANGED_EVENT, onLocal);
    if (channel) channel.onmessage = refresh;
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener(DATA_CHANGED_EVENT, onLocal);
      channel?.close();
    };
  }, [queryClient]);
  return null;
}
