import { NotesDrawer } from "./NotesDrawer";
import { NotesFeed } from "./NotesFeed";
import { useCreateEmitterNote, useDeleteEmitterNote, useEmitterNotes } from "../../state/hooks/useEmitterNotes";
import { useCreatePlatformNote, useDeletePlatformNote, usePlatformNotes } from "../../state/hooks/usePlatformNotes";

/** An Emitter's analyst notes, for pages under it that aren't the Emitter's
 * own page (a test run, its report) — so the Notes tab is still there. */
export function EmitterNotesDrawer({ emitterId, name }: { emitterId: string; name: string }) {
  const { data: notes, isLoading } = useEmitterNotes(emitterId);
  const { mutateAsync: create, isPending } = useCreateEmitterNote(emitterId);
  const { mutateAsync: remove } = useDeleteEmitterNote(emitterId);
  const draftKey = `notes-draft:emitter:${emitterId}`;
  return (
    <NotesDrawer count={notes?.length ?? 0} subject={name} draftKey={draftKey}>
      <NotesFeed
        key={emitterId}
        draftKey={draftKey}
        notes={notes}
        isLoading={isLoading}
        placeholder="Your own running notes/observations about this Emitter — separate from the description."
        onAdd={(body) => create(body)}
        isAdding={isPending}
        onDelete={(noteId) => remove(noteId)}
        inDrawer
      />
    </NotesDrawer>
  );
}

/** A Platform's analyst notes, for its test pages. */
export function PlatformNotesDrawer({ platformId, name }: { platformId: string; name: string }) {
  const { data: notes, isLoading } = usePlatformNotes(platformId);
  const { mutateAsync: create, isPending } = useCreatePlatformNote(platformId);
  const { mutateAsync: remove } = useDeletePlatformNote(platformId);
  const draftKey = `notes-draft:platform:${platformId}`;
  return (
    <NotesDrawer count={notes?.length ?? 0} subject={name} draftKey={draftKey}>
      <NotesFeed
        key={platformId}
        draftKey={draftKey}
        notes={notes}
        isLoading={isLoading}
        placeholder="Your own running notes/observations about this Platform — separate from the description."
        onAdd={(body) => create(body)}
        isAdding={isPending}
        onDelete={(noteId) => remove(noteId)}
        inDrawer
      />
    </NotesDrawer>
  );
}
