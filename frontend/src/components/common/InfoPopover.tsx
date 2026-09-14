import { useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useFloatingPosition } from "./useFloatingPosition";

export function HoverInfo({ label, children }: { label: ReactNode; children: ReactNode }) {
  const triggerRef = useRef<HTMLSpanElement>(null);
  const contentRef = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const pos = useFloatingPosition(triggerRef, contentRef, open);

  return (
    <span
      ref={triggerRef}
      className="info-popover-trigger"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      {label}
      {pos &&
        createPortal(
          <span ref={contentRef} className="info-popover-content" style={{ top: pos.top, left: pos.left }}>
            {children}
          </span>,
          document.body,
        )}
    </span>
  );
}
