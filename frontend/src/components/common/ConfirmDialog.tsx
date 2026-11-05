import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useDialogFocus } from "./useDialogFocus";

interface ConfirmState {
  message: string;
  resolve: (value: boolean) => void;
  confirmLabel?: string;
  danger?: boolean;
}

interface ConfirmOptions {
  /** The confirm button's label — "Delete" when not given. */
  confirmLabel?: string;
  /** Style the button as destructive with your own label (e.g. "Discard"). A
   * plain delete is destructive already; another label isn't, unless this is set. */
  danger?: boolean;
}

/** A confirmation dialog. With no options it's a delete ("Delete", in red);
 * pass `confirmLabel` for anything else, and `danger` when it's still
 * destructive (discard, revert). */
export function useConfirmDialog(): {
  confirmDelete: (message: string, options?: ConfirmOptions) => Promise<boolean>;
  dialog: ReactNode;
} {
  const [state, setState] = useState<ConfirmState | null>(null);

  const confirmDelete = useCallback((message: string, options?: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      setState({ message, resolve, confirmLabel: options?.confirmLabel, danger: options?.danger });
    });
  }, []);

  function respond(result: boolean) {
    state?.resolve(result);
    setState(null);
  }

  const dialog = state ? <ConfirmBox state={state} respond={respond} /> : null;

  return { confirmDelete, dialog };
}

/** The confirm dialog itself: Cancel has focus (the safe choice), Escape
 * cancels, Tab stays inside, and focus goes back where it was. */
function ConfirmBox({ state, respond }: { state: ConfirmState; respond: (result: boolean) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useDialogFocus(ref, ".confirm-cancel");
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") respond(false);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [respond]);
  return (
    <div className="modal-overlay" onClick={() => respond(false)}>
      <div
        ref={ref}
        className="modal-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-describedby="confirm-message"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="confirm-message" id="confirm-message">
          {state.message}
        </p>
        <div className="modal-actions">
          <button type="button" className="button secondary confirm-cancel" onClick={() => respond(false)}>
            Cancel
          </button>
          {state.confirmLabel ? (
            <button
              type="button"
              className={state.danger ? "danger-button" : "button primary"}
              onClick={() => respond(true)}
            >
              {state.confirmLabel}
            </button>
          ) : (
            <button type="button" className="danger-button" onClick={() => respond(true)}>
              Delete
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
