import { useEffect, useState, type ReactNode } from "react";
import { readDraft } from "./NotesFeed";

const OPEN_KEY = "notes-drawer-open";

function readOpen(): boolean {
  try {
    return localStorage.getItem(OPEN_KEY) === "1";
  } catch {
    return false;
  }
}

/** Whether the Analyst notes panel is open — one setting for every page, so
 * it stays open (or closed) as you move between Emitters, Platforms, MDFs and
 * Intercepts. Pages share it through a window event. */
export function useNotesDrawerOpen(): [boolean, (open: boolean) => void] {
  const [open, setOpenState] = useState(readOpen);
  useEffect(() => {
    const sync = () => setOpenState(readOpen());
    window.addEventListener("notes-drawer-change", sync);
    return () => window.removeEventListener("notes-drawer-change", sync);
  }, []);
  function setOpen(next: boolean) {
    setOpenState(next);
    try {
      localStorage.setItem(OPEN_KEY, next ? "1" : "0");
    } catch {
      // Storage unavailable — it just won't be remembered.
    }
    window.dispatchEvent(new Event("notes-drawer-change"));
  }
  return [open, setOpen];
}

/** Analyst notes kept to hand while browsing a page: a tab fixed to the right
 * edge of the window opens a panel that stays put as the page scrolls, without
 * blocking the page behind it. */
export function NotesDrawer({
  count,
  subject,
  draftKey,
  children,
}: {
  count: number;
  /** Where the panel's unsent note is kept (NotesFeed's draftKey), to flag it on the closed tab. */
  draftKey?: string;
  /** What the notes are about, for the panel's title (e.g. the Emitter's name). */
  subject: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useNotesDrawerOpen();

  if (!open) {
    const hasDraft = !!draftKey && !!readDraft(draftKey).trim();
    return (
      <button
        type="button"
        className="notes-drawer-tab"
        onClick={() => setOpen(true)}
        title={hasDraft ? "Open the analyst notes — you have a note not added yet" : "Open the analyst notes"}
        aria-label={`Analyst notes (${count})${hasDraft ? ", unsent draft" : ""}`}
      >
        <span className="notes-drawer-tab-label">Notes</span>
        <span className="notes-drawer-tab-count">{count}</span>
        {hasDraft && (
          <span className="notes-drawer-tab-draft" title="You have a note written but not added yet">
            ✎
          </span>
        )}
      </button>
    );
  }
  return (
    <aside
      className="notes-drawer"
      aria-label="Analyst notes"
      onKeyDown={(e) => {
        if (e.key === "Escape") setOpen(false);
      }}
    >
      <div className="notes-drawer-header">
        <div>
          <h4>
            Analyst notes <span className="section-count">{count}</span>
          </h4>
          <span className="hint-text notes-drawer-subject">{subject}</span>
        </div>
        <button type="button" className="link-button" onClick={() => setOpen(false)} aria-label="Close the analyst notes">
          ✕
        </button>
      </div>
      <div className="notes-drawer-body">{children}</div>
    </aside>
  );
}
