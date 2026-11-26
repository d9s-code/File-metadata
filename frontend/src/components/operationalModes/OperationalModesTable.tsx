import { useState, type FormEvent } from "react";
import { MenuButton } from "../common/MenuButton";
import { EmptyState } from "../common/EmptyState";
import { RequireRole } from "../../auth/RequireAuth";
import { useConfirmDialog } from "../common/ConfirmDialog";
import { ApiRequestError } from "../../api/client";
import type { OperationalMode } from "../../api/operationalModes";
import { useEmitter } from "../../state/hooks/useEmitters";
import { useEmitterCheckoutState } from "../../state/hooks/useEmitterCheckout";
import {
  useCreateOperationalMode,
  useDeleteOperationalMode,
  useOperationalModes,
  useUpdateOperationalMode,
} from "../../state/hooks/useOperationalModes";

/** The illumination time as typed: a number above 0, or empty. */
export function illuminationProblem(text: string): string | null {
  return text.trim() && !(Number(text) > 0) ? "A number of milliseconds above 0, or leave it empty" : null;
}

function OperationalModeForm({ emitterId, initial, onClose }: { emitterId: string; initial?: OperationalMode; onClose: () => void }) {
  const create = useCreateOperationalMode(emitterId);
  const update = useUpdateOperationalMode(emitterId);
  const [name, setName] = useState(initial?.name ?? "");
  const [illumination, setIllumination] = useState(initial?.illumination_time_ms != null ? String(initial.illumination_time_ms) : "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [error, setError] = useState<string | null>(null);
  const problem = illuminationProblem(illumination);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError("Give it a name");
      return;
    }
    if (problem) return;
    const input = {
      name: name.trim(),
      illumination_time_ms: illumination.trim() ? Number(illumination) : null,
      description: description.trim() || null,
    };
    try {
      if (initial) await update.mutateAsync({ id: initial.id, input });
      else await create.mutateAsync(input);
      onClose();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Couldn't save it");
    }
  }

  return (
    <form className="card inline-form" onSubmit={submit}>
      {initial && <h2 className="as-h4 inline-form-title">Editing operational mode &ldquo;{initial.name}&rdquo;</h2>}
      <label className="inline-field">
        Name
        <input placeholder="e.g. Volume search" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
      </label>
      <label className="inline-field">
        Illumination time (ms)
        <input
          type="number"
          step="any"
          min="0"
          placeholder="Emitter's"
          value={illumination}
          aria-invalid={!!problem || undefined}
          title="How long the beam lights up a Platform each scan in this mode — its Modes take it in the dwell planner. Empty: the Emitter's."
          onChange={(e) => setIllumination(e.target.value)}
        />
      </label>
      <label className="inline-field operational-mode-description">
        Description
        <input placeholder="Optional" value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
      <button type="submit" disabled={create.isPending || update.isPending || !!problem}>
        {initial ? "Save" : "Add operational mode"}
      </button>
      <button type="button" className="icon-button" onClick={onClose}>
        Cancel
      </button>
      {(problem || error) && <div className="error-text">{problem ?? error}</div>}
    </form>
  );
}

const ms = (v: number) => `${Number(v.toFixed(3))} ms`;

/** The radar's operational modes — volume search, track… — on the Emitter's
 * Groups & Sources tab. Its Modes are linked to them (on the Mode, or in a
 * batch) and take their illumination time in the dwell planner. */
export function OperationalModesTable({ emitterId }: { emitterId: string }) {
  const { data: rows } = useOperationalModes(emitterId);
  const { data: emitter } = useEmitter(emitterId);
  const { canEdit } = useEmitterCheckoutState(emitter);
  const editTitle = canEdit ? undefined : "Start editing this Emitter first";
  const del = useDeleteOperationalMode(emitterId);
  const { confirmDelete, dialog } = useConfirmDialog();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<OperationalMode | null>(null);
  const fallback =
    emitter?.illumination_time_ms != null ? `the Emitter's ${ms(emitter.illumination_time_ms)}` : "worked out from the planner's beamwidth";

  async function remove(row: OperationalMode) {
    const linked = row.modes_count
      ? ` Its ${row.modes_count} Mode${row.modes_count === 1 ? " stays" : "s stay"}, linked to none.`
      : "";
    if (await confirmDelete(`Delete operational mode "${row.name}"?${linked}`)) await del.mutateAsync(row.id);
  }

  return (
    <section className="card" aria-label="Operational modes">
      <div className="card-header">
        <h2 className="as-h4">Operational modes</h2>
        <RequireRole minimum="editor">
          <button
            className="button secondary small"
            disabled={!canEdit || adding || !!editing}
            title={editTitle}
            onClick={() => setAdding(true)}
          >
            + Add operational mode
          </button>
        </RequireRole>
      </div>
      {!rows?.length ? (
        <EmptyState
          compact
          icon="◎"
          title="No operational modes yet"
          message="The radar's operational modes — volume search, horizon search, track… Link its Modes to the one they're transmitted in, and they take its illumination time in the dwell planner."
        />
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th className="num">Illumination time</th>
              <th className="num">Modes</th>
              <th>Description</th>
              <th className="row-actions" aria-label="Actions"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((o) => (
              <tr key={o.id}>
                <td>{o.name}</td>
                <td className="num">
                  {o.illumination_time_ms != null ? ms(o.illumination_time_ms) : <span className="hint-text" title={`Its Modes take ${fallback}`}>—</span>}
                </td>
                <td className="num">{o.modes_count}</td>
                <td>{o.description ?? <span className="hint-text">—</span>}</td>
                <td className="row-actions">
                  <RequireRole minimum="editor">
                    <MenuButton
                      label="⋯"
                      className="row-menu-button"
                      ariaLabel={`Actions for ${o.name}`}
                      items={[
                        { label: "Edit", disabled: !canEdit, title: editTitle, onSelect: () => setEditing(o) },
                        { label: "Delete…", danger: true, disabled: !canEdit, title: editTitle, onSelect: () => void remove(o) },
                      ]}
                    />
                  </RequireRole>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="hint-text operational-modes-hint">
        A Mode takes its operational mode&apos;s illumination time; with none set, {fallback}. Link Modes under a Mode&apos;s More options, or
        several at once with Batch edit. Not exported.
      </p>
      <RequireRole minimum="editor">
        {editing ? (
          <OperationalModeForm key={editing.id} emitterId={emitterId} initial={editing} onClose={() => setEditing(null)} />
        ) : adding ? (
          <OperationalModeForm emitterId={emitterId} onClose={() => setAdding(false)} />
        ) : null}
      </RequireRole>
      {dialog}
    </section>
  );
}
