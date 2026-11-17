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
    // A change while this tab was out of sight: refresh once it's shown again.
    let missed = false;
    const refresh = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (document.visibilityState === "hidden") {
          // Out of sight: mark it all stale, fetch nothing until it's looked at.
          missed = true;
          void queryClient.invalidateQueries({ predicate: refreshable, refetchType: "none" });
          return;
        }
        // A fetch still under way is left to finish, not sent again: quick
        // changes in a row must not pile requests up on the server.
        void queryClient.invalidateQueries({ predicate: refreshable }, { cancelRefetch: false });
      }, SETTLE_MS);
    };
    const onVisible = () => {
      if (document.visibilityState !== "visible" || !missed) return;
      missed = false;
      void queryClient.refetchQueries({ predicate: refreshable, type: "active", stale: true }, { cancelRefetch: false });
    };
    document.addEventListener("visibilitychange", onVisible);
    const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(CHANNEL);
    const onLocal = () => {
      refresh();
      channel?.postMessage("changed");
    };
    window.addEventListener(DATA_CHANGED_EVENT, onLocal);
    if (channel) channel.onmessage = refresh;
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener(DATA_CHANGED_EVENT, onLocal);
      channel?.close();
    };
  }, [queryClient]);
  return null;
}
