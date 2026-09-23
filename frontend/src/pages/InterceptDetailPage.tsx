import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useEmitter } from "../state/hooks/useEmitters";
import { useEwGroups } from "../state/hooks/useEwGroups";
import { useFunctionGroups } from "../state/hooks/useFunctionGroups";
import { useSources } from "../state/hooks/useSources";
import {
  useCreateInterceptEntry,
  useDeleteIntercept,
  useDeleteInterceptEntry,
  useInterceptEntries,
  useIntercept,
  useUpdateIntercept,
} from "../state/hooks/useIntercepts";
import {
  useCreateInterceptNote,
  useDeleteInterceptNote,
  useInterceptNotes,
} from "../state/hooks/useInterceptNotes";
import { RequireRole } from "../auth/RequireAuth";
import { ApiRequestError } from "../api/client";
import { LoadingState } from "../components/common/LoadingState";
import { Modal } from "../components/common/Modal";
import { NotesFeed } from "../components/common/NotesFeed";
import { useConfirmDialog } from "../components/common/ConfirmDialog";
import { ModeForm } from "../components/modes/ModeForm";
import type { InterceptEntry, PriType } from "../types/domain";

function EntryAddForm({ interceptId }: { interceptId: string }) {
  const createEntry = useCreateInterceptEntry(interceptId);
  const [priType, setPriType] = useState<PriType>("fixed");
  const [rfMin, setRfMin] = useState("");
  const [rfMax, setRfMax] = useState("");
  const [rfMean, setRfMean] = useState("");
  const [pwMin, setPwMin] = useState("");
  const [pwMax, setPwMax] = useState("");
  const [pwMean, setPwMean] = useState("");
  const [priMin, setPriMin] = useState("");
  const [priMax, setPriMax] = useState("");
  const [priMean, setPriMean] = useState("");
  const [jitterMean, setJitterMean] = useState("");
  const [staggerValues, setStaggerValues] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await createEntry.mutateAsync({
        pri_type: priType,
        rf_min_mhz: rfMin ? Number(rfMin) : undefined,
        rf_max_mhz: rfMax ? Number(rfMax) : undefined,
        rf_mean_mhz: Number(rfMean),
        pw_min_us: pwMin ? Number(pwMin) : undefined,
        pw_max_us: pwMax ? Number(pwMax) : undefined,
        pw_mean_us: Number(pwMean),
        pri_min_us: priMin ? Number(priMin) : undefined,
        pri_max_us: priMax ? Number(priMax) : undefined,
        pri_mean_us: Number(priMean),
        jitter_mean_us: priType === "fixed" ? Number(jitterMean) : undefined,
        stagger_values:
          priType === "stagger"
            ? staggerValues
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean)
                .map(Number)
            : undefined,
        notes: notes || undefined,
      });
      setRfMin("");
      setRfMax("");
      setRfMean("");
      setPwMin("");
      setPwMax("");
      setPwMean("");
      setPriMin("");
      setPriMax("");
      setPriMean("");
      setJitterMean("");
      setStaggerValues("");
      setNotes("");
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Failed to add entry");
    }
  }

  return (
    <form className="card inline-form" onSubmit={handleSubmit}>
      <select value={priType} onChange={(e) => setPriType(e.target.value as PriType)}>
        <option value="fixed">Fixed</option>
        <option value="stagger">Stagger</option>
      </select>
      <label>
        RF min (MHz)
        <input type="number" step="any" value={rfMin} onChange={(e) => setRfMin(e.target.value)} />
      </label>
      <label>
        RF max (MHz)
        <input type="number" step="any" value={rfMax} onChange={(e) => setRfMax(e.target.value)} />
      </label>
      <label>
        RF mean (MHz)
        <input type="number" step="any" value={rfMean} onChange={(e) => setRfMean(e.target.value)} required />
      </label>
      <label>
        {priType === "stagger" ? "Frame-time min (µs)" : "PRI min (µs)"}
        <input type="number" step="any" value={priMin} onChange={(e) => setPriMin(e.target.value)} />
      </label>
      <label>
        {priType === "stagger" ? "Frame-time max (µs)" : "PRI max (µs)"}
        <input type="number" step="any" value={priMax} onChange={(e) => setPriMax(e.target.value)} />
      </label>
      <label>
        {priType === "stagger" ? "Frame-time mean (µs)" : "PRI mean (µs)"}
        <input type="number" step="any" value={priMean} onChange={(e) => setPriMean(e.target.value)} required />
      </label>
      {priType === "fixed" ? (
        <label>
          Jitter mean (µs)
          <input type="number" step="any" value={jitterMean} onChange={(e) => setJitterMean(e.target.value)} required />
        </label>
      ) : (
        <label className="wide-label">
          Stagger values (comma-separated µs, in order)
          <input
            placeholder="800, 850, 900, 780"
            value={staggerValues}
            onChange={(e) => setStaggerValues(e.target.value)}
            required
          />
        </label>
      )}
      <label>
        PW min (µs)
        <input type="number" step="any" value={pwMin} onChange={(e) => setPwMin(e.target.value)} />
      </label>
      <label>
        PW max (µs)
        <input type="number" step="any" value={pwMax} onChange={(e) => setPwMax(e.target.value)} />
      </label>
      <label>
        PW mean (µs)
        <input type="number" step="any" value={pwMean} onChange={(e) => setPwMean(e.target.value)} required />
      </label>
      <input placeholder="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
      <button type="submit" disabled={createEntry.isPending}>
        Add Entry
      </button>
      {error && <div className="error-text">{error}</div>}
    </form>
  );
}

function EntryRow({
  entry,
  emitterId,
  canEdit,
  onDelete,
}: {
  entry: InterceptEntry;
  emitterId: string;
  canEdit: boolean;
  onDelete: (entry: InterceptEntry) => void;
}) {
  const { data: ewGroups } = useEwGroups(emitterId);
  const { data: sources } = useSources(emitterId);
  const { data: functionGroups } = useFunctionGroups(emitterId);
  const [showCreateMode, setShowCreateMode] = useState(false);

  const priLabel = entry.pri_type === "stagger" ? "Frame-time" : "PRI";

  return (
    <>
      <tr>
        <td>{entry.pri_type}</td>
        <td>
          {entry.rf_min_mhz ?? "—"} / {entry.rf_max_mhz ?? "—"} / <strong>{entry.rf_mean_mhz}</strong>
        </td>
        <td title={`${priLabel} min/max/mean`}>
          {entry.pri_min_us ?? "—"} / {entry.pri_max_us ?? "—"} / <strong>{entry.pri_mean_us}</strong>
        </td>
        <td>
          {entry.pri_type === "fixed"
            ? entry.jitter_mean_us != null
              ? `jitter ${entry.jitter_mean_us} µs`
              : "—"
            : entry.stagger_values && entry.stagger_values.length > 0
              ? `[${entry.stagger_values.join(", ")}] µs`
              : "—"}
        </td>
        <td>
          {entry.pw_min_us ?? "—"} / {entry.pw_max_us ?? "—"} / <strong>{entry.pw_mean_us}</strong>
        </td>
        <td>{entry.notes ?? "—"}</td>
        <td>
          {entry.derived_mode_ids.length === 0 ? (
            <span className="hint-text">—</span>
          ) : (
            <span className="hint-text">{entry.derived_mode_ids.length} Mode(s)</span>
          )}
        </td>
        <td>
          <RequireRole minimum="editor">
            <button
              className="link-button"
              disabled={!canEdit}
              title={canEdit ? undefined : "Start editing the owning Emitter first"}
              onClick={() => setShowCreateMode((v) => !v)}
            >
              {showCreateMode ? "Cancel" : "Create Mode from this Entry"}
            </button>{" "}
            <button className="link-button link-button-danger" onClick={() => onDelete(entry)}>
              Delete
            </button>
          </RequireRole>
        </td>
      </tr>
      {showCreateMode && (
        <tr>
          <td colSpan={8}>
            <p className="hint-text">
              RF/PW/{priLabel} pre-filled from this entry (min/max fall back to the mean when not set).
              {entry.pri_type === "fixed" && " Jitter min and max both take the entry's jitter mean."}
            </p>
            <ModeForm
              emitterId={emitterId}
              ewGroups={ewGroups ?? []}
              sources={sources ?? []}
              functionGroups={functionGroups}
              fixedDerivedFromInterceptEntryId={entry.id}
              observedValueOptions={[
                {
                  key: entry.id,
                  label: "This Intercept entry",
                  values: {
                    rf_min_mhz: entry.rf_min_mhz ?? entry.rf_mean_mhz,
                    rf_max_mhz: entry.rf_max_mhz ?? entry.rf_mean_mhz,
                    pw_min_us: entry.pw_min_us ?? entry.pw_mean_us,
                    pw_max_us: entry.pw_max_us ?? entry.pw_mean_us,
                    pri_type: entry.pri_type,
                    pri_min_us: entry.pri_type === "fixed" ? (entry.pri_min_us ?? entry.pri_mean_us) : undefined,
                    pri_max_us: entry.pri_type === "fixed" ? (entry.pri_max_us ?? entry.pri_mean_us) : undefined,
                    jitter_mean_us: entry.pri_type === "fixed" ? (entry.jitter_mean_us ?? undefined) : undefined,
                    pri_stagger_values_us: entry.pri_type === "stagger" ? (entry.stagger_values ?? undefined) : undefined,
                  },
                },
              ]}
              onClose={() => setShowCreateMode(false)}
            />
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
  const { data: notes, isLoading: notesLoading } = useInterceptNotes(interceptId ?? "");
  const createNote = useCreateInterceptNote(interceptId ?? "");
  const deleteNote = useDeleteInterceptNote(interceptId ?? "");
  const deleteEntry = useDeleteInterceptEntry(interceptId ?? "");
  const deleteIntercept = useDeleteIntercept();
  const updateIntercept = useUpdateIntercept();
  const { confirmDelete, dialog } = useConfirmDialog();

  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [deleteError, setDeleteError] = useState<string | null>(null);

  if (isLoading || !intercept) return <LoadingState label="Loading intercept…" />;

  function startEdit() {
    if (!intercept) return;
    setEditName(intercept.name);
    setEditDescription(intercept.description ?? "");
    setIsEditing(true);
  }

  async function handleSaveEdit() {
    if (!interceptId) return;
    await updateIntercept.mutateAsync({
      interceptId,
      input: { name: editName, description: editDescription || undefined },
    });
    setIsEditing(false);
  }

  async function handleDeleteEntry(entry: InterceptEntry) {
    setDeleteError(null);
    if (!(await confirmDelete("Delete this entry? Any Mode already created from it is unaffected."))) return;
    try {
      await deleteEntry.mutateAsync(entry.id);
    } catch (err) {
      setDeleteError(err instanceof ApiRequestError ? err.message : "Failed to delete entry");
    }
  }

  async function handleDeleteIntercept() {
    if (!interceptId) return;
    setDeleteError(null);
    if (
      !(await confirmDelete(
        `Delete Intercept "${intercept?.name}"? This removes all its entries and notes. Any Mode already created from an entry is unaffected.`,
      ))
    )
      return;
    try {
      await deleteIntercept.mutateAsync(interceptId);
      navigate("/intercepts");
    } catch (err) {
      setDeleteError(err instanceof ApiRequestError ? err.message : "Failed to delete Intercept");
    }
  }

  // Modes can only be created against an Emitter that's currently checked
  // out — the same gate every other Mode-creation entry point respects.
  const canEdit = !!emitter?.checked_out_by_id;

  return (
    <div className="page">
      <h1>
        {intercept.name}{" "}
        {emitter && (
          <span className="muted">
            (<Link to={`/emitters/${emitter.id}`}>{emitter.name}</Link>)
          </span>
        )}
      </h1>
      {intercept.description && <p className="muted">{intercept.description}</p>}
      <div className="status-row">
        <RequireRole minimum="editor">
          <button className="button secondary small" onClick={startEdit}>
            Edit Name/Description
          </button>
          <button className="button secondary small" onClick={() => void handleDeleteIntercept()}>
            Delete Intercept
          </button>
        </RequireRole>
      </div>
      {deleteError && <div className="error-text">{deleteError}</div>}

      {isEditing && (
        <Modal title="Edit Name/Description" onClose={() => setIsEditing(false)} wide>
          <div className="edit-fields">
            <label>
              Name
              <input
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="edit-input"
              />
            </label>
            <label>
              Description
              <textarea
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                className="edit-input"
                rows={6}
              />
            </label>
          </div>
          <div className="edit-actions">
            <button className="button primary" onClick={() => void handleSaveEdit()} disabled={updateIntercept.isPending}>
              {updateIntercept.isPending ? "Saving..." : "Save"}
            </button>
            <button className="button" onClick={() => setIsEditing(false)} disabled={updateIntercept.isPending}>
              Cancel
            </button>
          </div>
        </Modal>
      )}

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

      <section className="card">
        <h4>Entries</h4>
        {deleteError && <div className="error-text">{deleteError}</div>}
        {entriesLoading ? (
          <LoadingState label="Loading entries…" />
        ) : !entries || entries.length === 0 ? (
          <p className="hint-text">No entries logged yet — add one below.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Type</th>
                <th>RF min/max/mean</th>
                <th>PRI/Frame-time min/max/mean</th>
                <th>Jitter / Stagger</th>
                <th>PW min/max/mean</th>
                <th>Notes</th>
                <th>Derived Modes</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <EntryRow
                  key={entry.id}
                  entry={entry}
                  emitterId={intercept.emitter_id}
                  canEdit={canEdit}
                  onDelete={handleDeleteEntry}
                />
              ))}
            </tbody>
          </table>
        )}
        <RequireRole minimum="editor">
          <EntryAddForm interceptId={intercept.id} />
        </RequireRole>
      </section>
      {dialog}
    </div>
  );
}
