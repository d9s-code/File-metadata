import { useCallback, useState, type ReactNode } from "react";

interface ConfirmState {
  message: string;
  resolve: (value: boolean) => void;
}

export function useConfirmDialog(): { confirmDelete: (message: string) => Promise<boolean>; dialog: ReactNode } {
  const [state, setState] = useState<ConfirmState | null>(null);

  const confirmDelete = useCallback((message: string) => {
    return new Promise<boolean>((resolve) => {
      setState({ message, resolve });
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
          <button type="button" className="danger-button" onClick={() => respond(true)}>
            Delete
          </button>
        </div>
      </div>
    </div>
  ) : null;

  return { confirmDelete, dialog };
}
