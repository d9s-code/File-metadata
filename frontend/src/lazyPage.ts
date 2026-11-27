import { lazy, type ComponentType } from "react";

const loaders: (() => Promise<unknown>)[] = [];
const RELOADED = "page-chunk-reloaded";

/** A page loaded when it's first opened, not in the app's first download.
 * A deploy renames the built files: a tab opened before it may ask for one
 * that's gone, so that reloads the app once, to the new build. */
export function lazyPage<M, K extends keyof M>(load: () => Promise<M>, name: K) {
  const loadOnce = () =>
    load().catch((err) => {
      let reloaded = false;
      try {
        reloaded = sessionStorage.getItem(RELOADED) === "1";
        if (!reloaded) sessionStorage.setItem(RELOADED, "1");
      } catch {
        reloaded = true;
      }
      if (!reloaded) window.location.reload();
      throw err;
    });
  loaders.push(loadOnce);
  return lazy(async () => {
    const module = await loadOnce();
    try {
      sessionStorage.removeItem(RELOADED);
    } catch {
      // Not kept; fine.
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { default: module[name] as M[K] & ComponentType<any> };
  });
}

/** Once the first page is up and the browser is idle: fetch every other
 * page's code in the background, so opening one later is instant. */
export function preloadPages() {
  const run = () => {
    let i = 0;
    const next = () => {
      if (i >= loaders.length) return;
      void loaders[i++]().catch(() => undefined).finally(() => setTimeout(next, 0));
    };
    next();
  };
  const idle = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void }).requestIdleCallback;
  if (idle) idle(run, { timeout: 3000 });
  else setTimeout(run, 1500);
}
