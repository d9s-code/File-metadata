import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useEmitter } from "../state/hooks/useEmitters";
import { useEwGroups } from "../state/hooks/useEwGroups";
import { useFunctionGroups } from "../state/hooks/useFunctionGroups";
import { useSources } from "../state/hooks/useSources";
import { useEmitterModes } from "../state/hooks/useModes";
import { useEmitterCheckoutState } from "../state/hooks/useEmitterCheckout";
import {
  useDeleteIntercept,
  useDeleteInterceptEntry,
  useInterceptEntries,
  useIntercept,
} from "../state/hooks/useIntercepts";
import {
  useCreateInterceptNote,
  useDeleteInterceptNote,
  useInterceptNotes,
} from "../state/hooks/useInterceptNotes";
import { RequireRole, useHasRole } from "../auth/RequireAuth";
import { ApiRequestError } from "../api/client";
import { LoadingState } from "../components/common/LoadingState";
import { EmptyState } from "../components/common/EmptyState";
import { MenuButton } from "../components/common/MenuButton";
import { NotesFeed } from "../components/common/NotesFeed";
import { useConfirmDialog } from "../components/common/ConfirmDialog";
import { ModeForm } from "../components/modes/ModeForm";
import { InterceptFormModal } from "../components/intercepts/InterceptFormModal";
import { EntryFormModal } from "../components/intercepts/EntryFormModal";
import { EntryMatchCell, MatchCounts } from "../components/intercepts/EntryMatchCell";
import { formatDay, modeLink } from "../components/intercepts/interceptFormat";
import { matchEntry, type EntryMatch, type EntryMatchStatus } from "../components/intercepts/interceptMatch";
import type { Emitter, InterceptEntry, Mode } from "../types/domain";

const PAGE_SIZE = 100;

const PRI_TYPE_LABEL: Record<string, string> = { fixed: "Fixed", stagger: "Stagger", cw: "CW", xlet: "X-let" };

/** A measured value: the mean, with the measured range under it when there
 * is one. A dash when the entry has none (a CW entry's PRI and PW). */
function MeasuredValue({ mean, min, max }: { mean: number | null; min?: number | null; max?: number | null }) {
  if (mean == null) return <span className="hint-text">—</span>;
  return (
    <>
      <strong>{mean}</strong>
      {(min != null || max != null) && (
        <div className="hint-text cell-subline">
          {min ?? "?"}–{max ?? "?"}
        </div>
      )}
    </>
  );
}

function CreateModeFromEntry({ entry, emitterId, onClose }: { entry: InterceptEntry; emitterId: string; onClose: () => void }) {
  const { data: ewGroups } = useEwGroups(emitterId);
  const { data: sources } = useSources(emitterId);
  const { data: functionGroups } = useFunctionGroups(emitterId);
  const priLabel = entry.pri_type === "stagger" ? "Frame time" : "PRI";
  const prefilled = entry.pri_type === "cw" ? "RF" : `RF/${priLabel}/PW`;
  // ModeForm picks its default EW Group and Source when it mounts, so wait for them.
  if (!ewGroups || !sources) return <LoadingState label="Loading EW Groups and Sources…" />;
  return (
    <>
      <p className="hint-text">
        {prefilled} pre-filled from this entry (min/max fall back to the mean when not measured).
        {entry.pri_type === "cw" && " A CW entry has no pulses, so fill in the Mode's PW range yourself."}
        {entry.pri_type === "fixed" && " Jitter min and max both take the entry's jitter mean."}
      </p>
      <ModeForm
        emitterId={emitterId}
        ewGroups={ewGroups}
        sources={sources}
        functionGroups={functionGroups}
        fixedDerivedFromInterceptEntryId={entry.id}
        prefillOnOpen
        observedValueOptions={[
          {
            key: entry.id,
            label: "This Intercept entry",
            values: {
              rf_min_mhz: entry.rf_min_mhz ?? entry.rf_mean_mhz,
              rf_max_mhz: entry.rf_max_mhz ?? entry.rf_mean_mhz,
              pw_min_us: entry.pw_min_us ?? entry.pw_mean_us ?? undefined,
              pw_max_us: entry.pw_max_us ?? entry.pw_mean_us ?? undefined,
              pri_type: entry.pri_type,
              pri_min_us: entry.pri_type === "fixed" ? (entry.pri_min_us ?? entry.pri_mean_us ?? undefined) : undefined,
              pri_max_us: entry.pri_type === "fixed" ? (entry.pri_max_us ?? entry.pri_mean_us ?? undefined) : undefined,
              jitter_mean_us: entry.pri_type === "fixed" ? (entry.jitter_mean_us ?? undefined) : undefined,
              pri_stagger_values_us: entry.pri_type === "stagger" ? (entry.stagger_values ?? undefined) : undefined,
            },
          },
        ]}
        onClose={onClose}
      />
    </>
  );
}

function EntryRow({
  entry,
  emitter,
  match,
  modeById,
  isMine,
  canWrite,
  onEdit,
  onDelete,
}: {
  entry: InterceptEntry;
  emitter: Emitter | undefined;
  /** Null while the Modes load. */
  match: EntryMatch | null;
  modeById: Map<string, Mode>;
  isMine: boolean;
  canWrite: boolean;
  onEdit: (entry: InterceptEntry) => void;
  onDelete: (entry: InterceptEntry) => void;
}) {
  const [showCreateMode, setShowCreateMode] = useState(false);
  const emitterId = emitter?.id ?? "";
  const createdModes = entry.derived_mode_ids.map((id) => modeById.get(id)).filter((m): m is Mode => !!m);

  return (
    <>
      <tr className={match?.status === "none" ? "entry-unmatched" : undefined}>
        <td>{PRI_TYPE_LABEL[entry.pri_type] ?? entry.pri_type}</td>
        <td>
          <MeasuredValue mean={entry.rf_mean_mhz} min={entry.rf_min_mhz} max={entry.rf_max_mhz} />
        </td>
        <td>
          <MeasuredValue mean={entry.pri_mean_us} min={entry.pri_min_us} max={entry.pri_max_us} />
          {entry.pri_type === "stagger" && <div className="hint-text cell-subline">frame time</div>}
        </td>
        <td>
          <MeasuredValue mean={entry.pw_mean_us} min={entry.pw_min_us} max={entry.pw_max_us} />
        </td>
        <td>
          {entry.pri_type === "cw"
            ? <span className="hint-text">—</span>
            : entry.pri_type === "fixed"
            ? (entry.jitter_mean_us ?? "—")
            : entry.stagger_values && entry.stagger_values.length > 0
              ? entry.stagger_values.join(", ")
              : "—"}
        </td>
        <td>{match ? <EntryMatchCell match={match} emitterId={emitterId} /> : <span className="hint-text">…</span>}</td>
        <td>
          {entry.derived_mode_ids.length === 0 ? (
            <span className="hint-text">—</span>
          ) : (
            <>
              {createdModes.map((m, i) => (
                <span key={m.id}>
                  {i > 0 && ", "}
                  <Link to={modeLink(emitterId, m)}>{m.name}</Link>
                </span>
              ))}
              {createdModes.length < entry.derived_mode_ids.length && (
                <span className="hint-text">
                  {createdModes.length > 0 && ", "}
                  {entry.derived_mode_ids.length - createdModes.length} deleted
                </span>
              )}
            </>
          )}
        </td>
        <td className="entry-notes">{entry.notes ?? <span className="hint-text">—</span>}</td>
        <td className="sticky-end row-actions">
          {canWrite && (
            <MenuButton
              label="⋯"
              className="row-menu-button"
              ariaLabel="Actions for this entry"
              items={[
                { label: "Edit entry", onSelect: () => onEdit(entry) },
                {
                  label: showCreateMode ? "Hide Mode form" : "Create Mode from this entry",
                  onSelect: () => setShowCreateMode((v) => !v),
                  disabled: !isMine,
                  title: isMine ? undefined : `Start editing ${emitter?.name ?? "the Emitter"} first`,
                },
                { label: "Delete entry", danger: true, onSelect: () => onDelete(entry) },
              ]}
            />
          )}
        </td>
      </tr>
      {showCreateMode && isMine && (
        <tr>
          <td colSpan={9}>
            <CreateModeFromEntry entry={entry} emitterId={emitterId} onClose={() => setShowCreateMode(false)} />
          </td>
        </tr>
      )}
    </>
  );
}

export function InterceptDetailPage() {
  const { interceptId } = useParams<{ interceptId: string }>();
  const navigate = useNavigate();
  const { data: intercept, isLoading } = useIntercept(interceptId ?? "");
  const { data: entries, isLoading: entriesLoading } = useInterceptEntries(interceptId ?? "");
  const { data: emitter } = useEmitter(intercept?.emitter_id);
  const { data: modes } = useEmitterModes(intercept?.emitter_id ?? "");
  const { isMine } = useEmitterCheckoutState(emitter);
  const { data: notes, isLoading: notesLoading } = useInterceptNotes(interceptId ?? "");
  const createNote = useCreateInterceptNote(interceptId ?? "");
  const deleteNote = useDeleteInterceptNote(interceptId ?? "");
  const deleteEntry = useDeleteInterceptEntry(interceptId ?? "");
  const deleteIntercept = useDeleteIntercept();
  const { confirmDelete, dialog } = useConfirmDialog();

  const canWrite = useHasRole("editor");
  const [showEditDetails, setShowEditDetails] = useState(false);
  const [entryForm, setEntryForm] = useState<{ entry?: InterceptEntry } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [show, setShow] = useState<"all" | EntryMatchStatus>("all");
  const [page, setPage] = useState(0);

  // Matched once per change rather than per render — an imported Intercept
  // can hold thousands of entries.
  const matched = useMemo(
    () => (entries ?? []).map((entry) => ({ entry, match: modes ? matchEntry(entry, modes) : null })),
    [entries, modes],
  );
  const modeById = useMemo(() => new Map((modes ?? []).map((m) => [m.id, m])), [modes]);

  if (isLoading || !intercept) return <LoadingState label="Loading intercept…" />;

  const counts = modes
    ? matched.reduce((c, { match }) => ({ ...c, [match!.status]: c[match!.status] + 1 }), { match: 0, near: 0, none: 0 })
    : null;
  const shown = show === "all" ? matched : matched.filter(({ match }) => match?.status === show);
  const pageCount = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = shown.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  async function handleDeleteEntry(entry: InterceptEntry) {
    setError(null);
    if (!(await confirmDelete("Delete this entry? Any Mode already created from it is unaffected."))) return;
    try {
      await deleteEntry.mutateAsync(entry.id);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Failed to delete entry");
    }
  }

  async function handleDeleteIntercept() {
    if (!interceptId || !intercept) return;
    setError(null);
    if (
      !(await confirmDelete(
        `Delete Intercept "${intercept.name}"? This removes all its entries and notes. Any Mode already created from an entry is unaffected.`,
      ))
    )
      return;
    try {
      await deleteIntercept.mutateAsync(interceptId);
      navigate(emitter ? `/emitters/${emitter.id}?tab=intercepts` : "/intercepts");
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Failed to delete Intercept");
    }
  }

  const meta = [
    intercept.intercepted_on && `Recorded ${formatDay(intercept.intercepted_on)}`,
    intercept.collected_by && `collected by ${intercept.collected_by}`,
    `logged ${new Date(intercept.created_at).toLocaleDateString()}`,
  ].filter(Boolean);

  return (
    <div className="page">
      {emitter && <Link to={`/emitters/${emitter.id}?tab=intercepts`}>← {emitter.name} Intercepts</Link>}
      <div className="emitter-title-row">
        <h1>{intercept.name}</h1>
        <RequireRole minimum="editor">
          <div className="emitter-actions">
            <button type="button" className="button primary" onClick={() => setEntryForm({})}>
              + Add entry
            </button>
            <MenuButton
              label="More ▾"
              items={[
                { label: "Edit name, date & description", onSelect: () => setShowEditDetails(true) },
                { label: "Import entries from CSV", to: `/intercepts/import?intercept=${intercept.id}` },
                { label: "Delete Intercept", danger: true, onSelect: () => void handleDeleteIntercept() },
              ]}
            />
          </div>
        </RequireRole>
      </div>
      <p className="intercept-meta">{meta.join(" · ").replace(/^./, (c) => c.toUpperCase())}</p>
      {intercept.description && <p className="muted">{intercept.description}</p>}
      {error && <div className="error-text">{error}</div>}

      <section className="card">
        <div className="card-header">
          <h4>
            Entries <span className="section-count">{entries?.length ?? 0}</span>
          </h4>
          <span className="section-actions">
            {counts && <MatchCounts counts={counts} />}
            {counts && (entries?.length ?? 0) > 10 && (
              <select
                aria-label="Show entries"
                value={show}
                onChange={(e) => {
                  setShow(e.target.value as typeof show);
                  setPage(0);
                }}
              >
                <option value="all">All entries</option>
                <option value="none">No matching Mode</option>
                <option value="near">Near misses</option>
                <option value="match">Matches</option>
              </select>
            )}
          </span>
        </div>
        <p className="hint-text">
          Matched against {emitter?.name ?? "the Emitter"}&apos;s Modes on RF, PRI (frame time for a stagger) and PW, using
          each Mode&apos;s engineered range. A near miss is outside on one of the three.
          {canWrite && !isMine && counts && counts.none + counts.near > 0 && (
            <> To create a Mode from an entry, start editing {emitter?.name ?? "the Emitter"} first.</>
          )}
        </p>
        {entriesLoading ? (
          <LoadingState label="Loading entries…" />
        ) : !entries || entries.length === 0 ? (
          <EmptyState
            compact
            title="No entries yet"
            message={canWrite ? "Add one per contact or measurement in this recording." : undefined}
          />
        ) : (
          <div className="matrix-scroll">
            <table className="data-table intercept-entries">
              <thead>
                <tr>
                  <th>PRI type</th>
                  <th>RF (MHz)</th>
                  <th>PRI (µs)</th>
                  <th>PW (µs)</th>
                  <th>Jitter / stagger (µs)</th>
                  <th>Match</th>
                  <th>Modes created</th>
                  <th>Notes</th>
                  <th className="sticky-end" aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {pageRows.map(({ entry, match }) => (
                  <EntryRow
                    key={entry.id}
                    entry={entry}
                    emitter={emitter}
                    match={match}
                    modeById={modeById}
                    isMine={isMine}
                    canWrite={canWrite}
                    onEdit={(e) => setEntryForm({ entry: e })}
                    onDelete={(e) => void handleDeleteEntry(e)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
        {entries && entries.length > 0 && shown.length === 0 && <p className="hint-text">No entries of this kind.</p>}
        {pageCount > 1 && (
          <div className="list-pager">
            <button type="button" className="button secondary small" disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>
              ← Previous
            </button>
            <span>
              Entries {(safePage * PAGE_SIZE + 1).toLocaleString()}–{Math.min((safePage + 1) * PAGE_SIZE, shown.length).toLocaleString()} of{" "}
              {shown.length.toLocaleString()}
            </span>
            <button
              type="button"
              className="button secondary small"
              disabled={safePage >= pageCount - 1}
              onClick={() => setPage(safePage + 1)}
            >
              Next →
            </button>
          </div>
        )}
      </section>

      <section className="card">
        <h4>Analyst notes</h4>
        <NotesFeed
          notes={notes}
          isLoading={notesLoading}
          placeholder="Your own thoughts/observations about this Intercept as a whole."
          onAdd={(body) => createNote.mutateAsync(body)}
          isAdding={createNote.isPending}
          onDelete={(noteId) => deleteNote.mutateAsync(noteId)}
        />
      </section>

      {showEditDetails && <InterceptFormModal intercept={intercept} onClose={() => setShowEditDetails(false)} />}
      {entryForm && (
        <EntryFormModal interceptId={intercept.id} entry={entryForm.entry} onClose={() => setEntryForm(null)} />
      )}
      {dialog}
    </div>
  );
}
