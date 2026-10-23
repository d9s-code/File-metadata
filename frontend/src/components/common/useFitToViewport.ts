import { useLayoutEffect, type RefObject } from "react";

/** Room left under the card the box sits in. */
const MARGIN_PX = 16;

/** Caps a scrolling box's height so, with the page scrolled to the top, it
 * ends at the bottom of the window — its last row and its horizontal
 * scrollbar in view without scrolling the page, its card's bottom edge
 * too. Kept up to date as the window or anything above it changes size;
 * never below `minPx`. */
export function useFitToViewport(ref: RefObject<HTMLElement | null>, minPx = 240) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    function fit() {
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const top = rect.top + window.scrollY;
      // What's under the box that still belongs in view: the rest of its card.
      const card = el.closest<HTMLElement>("section, .card") ?? el;
      const below = Math.max(card.getBoundingClientRect().bottom - rect.bottom, 0) + MARGIN_PX;
      const height = `${Math.max(Math.floor(window.innerHeight - top - below), minPx)}px`;
      if (el.style.maxHeight !== height) el.style.maxHeight = height;
    }
    fit();
    // The page's size changes when something above the box opens or closes.
    const observer = new ResizeObserver(fit);
    observer.observe(document.body);
    window.addEventListener("resize", fit);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", fit);
    };
  }, [ref, minPx]);
}
