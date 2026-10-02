import { useCallback, useState, type ReactNode } from "react";

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

  const dialog = state ? (
    <div className="modal-overlay" onClick={() => respond(false)}>
      <div className="modal-dialog" role="alertdialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <p>{state.message}</p>
        <div className="modal-actions">
          <button type="button" className="icon-button" onClick={() => respond(false)}>
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
  ) : null;

  return { confirmDelete, dialog };
}
