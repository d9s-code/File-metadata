import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { AdminNav } from "../components/common/AdminNav";
import { LoadingState } from "../components/common/LoadingState";
import { Modal } from "../components/common/Modal";
import { ApiRequestError } from "../api/client";
import { functionCodeLabel, type FunctionCode } from "../api/functionCodes";
import { useFunctionCodeMutations, useFunctionCodes } from "../state/hooks/useFunctionCodes";

const message = (err: unknown, fallback: string) => (err instanceof ApiRequestError ? err.message : fallback);

/** One row, read or being edited in place. */
function CodeRow({
  fc,
  first,
  last,
  onMove,
  onDelete,
}: {
  fc: FunctionCode;
  first: boolean;
  last: boolean;
  onMove: (dir: -1 | 1) => void;
  onDelete: () => void;
}) {
  const { update } = useFunctionCodeMutations();
  const [editing, setEditing] = useState(false);
  const [code, setCode] = useState(fc.code);
  const [name, setName] = useState(fc.name);
  const [description, setDescription] = useState(fc.description ?? "");
  const [error, setError] = useState<string | null>(null);

  if (editing) {
    return (
      <tr className="fc-editing">
        <td />
        <td>
          <input value={code} onChange={(e) => setCode(e.target.value)} maxLength={32} aria-label="Code" autoFocus />
        </td>
        <td>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={200} aria-label="Name" />
        </td>
        <td>
          <input value={description} onChange={(e) => setDescription(e.target.value)} aria-label="Description" placeholder="Optional" />
          {error && <div className="error-text">{error}</div>}
        </td>
        <td className="num">{fc.emitter_count}</td>
        <td className="fc-actions">
          <button
            type="button"
            className="button primary small"
            disabled={update.isPending || !code.trim() || !name.trim()}
            onClick={() =>
              update.mutate(
                { id: fc.id, input: { code: code.trim(), name: name.trim(), description: description.trim() || null } },
                { onSuccess: () => setEditing(false), onError: (err) => setError(message(err, "Couldn't save it")) },
              )
            }
          >
            Save
          </button>
          <button type="button" className="button secondary small" onClick={() => setEditing(false)}>
            Cancel
          </button>
        </td>
      </tr>
    );
  }
  return (
    <tr>
      <td className="fc-order">
        <button type="button" className="icon-button" disabled={first} onClick={() => onMove(-1)} aria-label={`Move ${fc.code} up`}>
          ↑
        </button>
        <button type="button" className="icon-button" disabled={last} onClick={() => onMove(1)} aria-label={`Move ${fc.code} down`}>
          ↓
        </button>
      </td>
      <td>
        <strong className="fc-code">{fc.code}</strong>
      </td>
      <td>{fc.name}</td>
      <td className="hint-text">{fc.description ?? "—"}</td>
      <td className="num">
        {fc.emitter_count ? <Link to="/priorities">{fc.emitter_count}</Link> : <span className="hint-text">0</span>}
      </td>
      <td className="fc-actions">
        <button
          type="button"
          className="button secondary small"
          onClick={() => {
            setCode(fc.code);
            setName(fc.name);
            setDescription(fc.description ?? "");
            setError(null);
            setEditing(true);
          }}
        >
          Edit
        </button>
        <button type="button" className="button danger-outline small" onClick={onDelete}>
          Delete…
        </button>
      </td>
    </tr>
  );
}

/** Admin → Function codes: the kinds of emitter an Emitter can be. Every new
 * Emitter picks one, and the priority overview groups by them. */
export function AdminFunctionCodesPage() {
  const { data: codes, isLoading } = useFunctionCodes();
  const { create, update, remove } = useFunctionCodeMutations();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<FunctionCode | null>(null);
  const [moveTo, setMoveTo] = useState("");
  const [deleteError, setDeleteError] = useState<string | null>(null);

  if (isLoading || !codes) return <LoadingState label="Loading function codes…" />;

  function handleAdd(e: FormEvent) {
    e.preventDefault();
    setError(null);
    create.mutate(
      { code: code.trim(), name: name.trim(), description: description.trim() || null },
      {
        onSuccess: () => {
          setCode("");
          setName("");
          setDescription("");
        },
        onError: (err) => setError(message(err, "Couldn't add it")),
      },
    );
  }

  // Swap with the neighbour; the order is the one every list shows.
  async function move(i: number, dir: -1 | 1) {
    const a = codes![i];
    const b = codes![i + dir];
    if (!a || !b) return;
    const [sa, sb] = a.sort_order === b.sort_order ? [i + dir, i] : [b.sort_order, a.sort_order];
    await update.mutateAsync({ id: a.id, input: { sort_order: sa } });
    await update.mutateAsync({ id: b.id, input: { sort_order: sb } });
  }

  const others = deleting ? codes.filter((c) => c.id !== deleting.id) : [];

  return (
    <div className="page">
      <h1>Admin</h1>
      <AdminNav />
      <div className="card">
        <h2 className="as-h4">Function codes</h2>
        <p className="hint-text">
          What kind of emitter an Emitter is — fire control, search, navigation… Every new Emitter picks one, and{" "}
          <Link to="/priorities">Priorities</Link> groups by them. They aren&apos;t part of an Emitter&apos;s
          saved versions or its export. The order here is the order everywhere.
        </p>
        <form className="fc-add" onSubmit={handleAdd}>
          <label>
            Code
            <input value={code} onChange={(e) => setCode(e.target.value)} maxLength={32} placeholder="FC" required />
          </label>
          <label>
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={200} placeholder="Fire control" required />
          </label>
          <label className="fc-add-description">
            Description
            <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional" />
          </label>
          <button type="submit" className="button primary" disabled={create.isPending || !code.trim() || !name.trim()}>
            + Add
          </button>
        </form>
        {error && <p className="error-text">{error}</p>}
        {codes.length === 0 ? (
          <p className="hint-text">
            None yet. Until there&apos;s one, nobody can add an Emitter — the form asks for a function code.
          </p>
        ) : (
          <table className="data-table fc-table">
            <thead>
              <tr>
                <th aria-label="Order" />
                <th>Code</th>
                <th>Name</th>
                <th>Description</th>
                <th className="num">Emitters</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {codes.map((fc, i) => (
                <CodeRow
                  key={fc.id}
                  fc={fc}
                  first={i === 0}
                  last={i === codes.length - 1}
                  onMove={(dir) => void move(i, dir)}
                  onDelete={() => {
                    setDeleting(fc);
                    setMoveTo("");
                    setDeleteError(null);
                  }}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {deleting && (
        <Modal title={`Delete ${deleting.code}`} onClose={() => setDeleting(null)}>
          {deleting.emitter_count > 0 ? (
            <>
              <p>
                {deleting.emitter_count} Emitter{deleting.emitter_count === 1 ? " has" : "s have"}{" "}
                <strong>{functionCodeLabel(deleting)}</strong>. Pick the function code to move{" "}
                {deleting.emitter_count === 1 ? "it" : "them"} to.
              </p>
              <select value={moveTo} onChange={(e) => setMoveTo(e.target.value)} aria-label="Move them to">
                <option value="">— pick one —</option>
                {others.map((c) => (
                  <option key={c.id} value={c.id}>
                    {functionCodeLabel(c)}
                  </option>
                ))}
              </select>
            </>
          ) : (
            <p>
              Delete <strong>{functionCodeLabel(deleting)}</strong>? No Emitter has it.
            </p>
          )}
          {deleteError && <p className="error-text">{deleteError}</p>}
          <div className="modal-actions">
            <button type="button" className="button secondary" onClick={() => setDeleting(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="button danger"
              disabled={remove.isPending || (deleting.emitter_count > 0 && !moveTo)}
              onClick={() =>
                remove.mutate(
                  { id: deleting.id, moveTo: moveTo || undefined },
                  { onSuccess: () => setDeleting(null), onError: (err) => setDeleteError(message(err, "Couldn't delete it")) },
                )
              }
            >
              {deleting.emitter_count > 0 ? "Move and delete" : "Delete"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
