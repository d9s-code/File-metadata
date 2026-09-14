import { useLayoutEffect, useState, type RefObject } from "react";

const VIEWPORT_MARGIN = 8;

/**
 * Positions a fixed-position, portaled element under `triggerRef`, then nudges
 * it back inside the viewport once its size is known. Fixed + portaled so it
 * isn't clipped by a scroll-clipping ancestor (e.g. a horizontally-scrollable
 * table wrapper, whose `overflow-x: auto` forces `overflow-y` to clip too).
 */
export function useFloatingPosition(
  triggerRef: RefObject<HTMLElement | null>,
  contentRef: RefObject<HTMLElement | null>,
  open: boolean,
) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const triggerRect = triggerRef.current?.getBoundingClientRect();
    if (triggerRect) setPos({ top: triggerRect.bottom + 4, left: triggerRect.left });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useLayoutEffect(() => {
    if (!pos || !contentRef.current) return;
    const rect = contentRef.current.getBoundingClientRect();
    let { top, left } = pos;
    const overflowRight = rect.right - (window.innerWidth - VIEWPORT_MARGIN);
    if (overflowRight > 0) left -= overflowRight;
    left = Math.max(VIEWPORT_MARGIN, left);
    const overflowBottom = rect.bottom - (window.innerHeight - VIEWPORT_MARGIN);
    if (overflowBottom > 0) {
      const flippedTop = (triggerRef.current?.getBoundingClientRect().top ?? top) - rect.height - 4;
      top = flippedTop > VIEWPORT_MARGIN ? flippedTop : Math.max(VIEWPORT_MARGIN, top - overflowBottom);
    }
    if (top !== pos.top || left !== pos.left) setPos({ top, left });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pos?.top, pos?.left]);

  return pos;
}
