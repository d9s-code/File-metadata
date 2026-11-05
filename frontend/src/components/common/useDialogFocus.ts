import { useEffect, type RefObject } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Keyboard focus for a dialog: on open it moves into the dialog (to its
 * first field, else `initial`, else its first button), Tab and Shift+Tab stay
 * inside it, and on close it goes back to whatever had it before. */
export function useDialogFocus(ref: RefObject<HTMLElement | null>, initial?: string) {
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const before = document.activeElement as HTMLElement | null;
    const items = () => [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((e) => e.offsetParent !== null);
    // A field that asked for focus (autoFocus) keeps it.
    if (!dialog.contains(document.activeElement)) {
      const field = dialog.querySelector<HTMLElement>("input:not([type=hidden]), select, textarea");
      const target = field ?? (initial ? dialog.querySelector<HTMLElement>(initial) : null) ?? items()[0];
      target?.focus();
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Tab") return;
      const list = items();
      if (list.length === 0) return;
      const first = list[0];
      const last = list[list.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    dialog.addEventListener("keydown", onKeyDown);
    return () => {
      dialog.removeEventListener("keydown", onKeyDown);
      if (before && document.contains(before)) before.focus();
    };
  }, [ref, initial]);
}
