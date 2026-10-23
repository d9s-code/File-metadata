import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** Generic overlay dialog — same backdrop/card visual language as
 * useConfirmDialog's built-in confirm/cancel dialog, but a content slot
 * instead of a fixed message+two-buttons shape. Closes on backdrop click or
 * Escape. Rendered at the end of the page, so nothing on it (the checkout
 * reminder, a sticky table header) can sit above the backdrop. */
export function Modal({
  title,
  onClose,
  children,
  wide,
  className,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Use for content wider than a short confirm message, e.g. a multi-field form. */
  wide?: boolean;
  /** Extra class on the dialog, for a dialog sized to its content. */
  className?: string;
}) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div
        className={["modal-dialog", wide && "modal-dialog-wide", className].filter(Boolean).join(" ")}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h4>{title}</h4>
          <button type="button" className="link-button" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
