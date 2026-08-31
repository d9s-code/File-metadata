import { useEffect, type ReactNode } from "react";

/** Generic overlay dialog — same backdrop/card visual language as
 * useConfirmDialog's built-in confirm/cancel dialog, but a content slot
 * instead of a fixed message+two-buttons shape. Closes on backdrop click or
 * Escape. */
export function Modal({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Use for content wider than a short confirm message, e.g. a multi-field form. */
  wide?: boolean;
}) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className={wide ? "modal-dialog modal-dialog-wide" : "modal-dialog"}
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
    </div>
  );
}
