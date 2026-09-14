import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useCreateEmitter, useDeleteEmitter, useEmitters } from "../state/hooks/useEmitters";
import { RequireRole } from "../auth/RequireAuth";
import { ApiRequestError } from "../api/client";
import { LoadingState } from "../components/common/LoadingState";
import { EmptyState } from "../components/common/EmptyState";
import { Modal } from "../components/common/Modal";
import { useConfirmDialog } from "../components/common/ConfirmDialog";
import { SortableColumnHeader } from "../components/common/SortableColumnHeader";
import { useSortableTable } from "../components/common/useSortableTable";
import { compareNullable, compareStrings } from "../components/common/sortUtils";
import { emitterStatusLabel } from "../components/common/emitterStatusLabel";
import type { Emitter } from "../types/domain";

type EmitterSortKey =
  | "name"
  | "designation"
  | "status"
  | "rf_min"
  | "rf_max"
  | "pw_min"
  | "pw_max"
  | "pri_min"
  | "pri_max"
  | "scan_min"
  | "scan_max"
  | "modes_passing";

function compareEmitters(a: Emitter, b: Emitter, key: EmitterSortKey, dir: "asc" | "desc"): number {
  switch (key) {
    case "name":
      return compareStrings(a.name, b.name, dir);
    case "designation":
      return compareStrings(a.designation, b.designation, dir);
    case "status":
      return compareStrings(a.status, b.status, dir);
    case "rf_min":
      return compareNullable(a.summary.rf_min_mhz, b.summary.rf_min_mhz, dir);
    case "rf_max":
      return compareNullable(a.summary.rf_max_mhz, b.summary.rf_max_mhz, dir);
    case "pw_min":
      return compareNullable(a.summary.pw_min_us, b.summary.pw_min_us, dir);
    case "pw_max":
      return compareNullable(a.summary.pw_max_us, b.summary.pw_max_us, dir);
    case "pri_min":
      return compareNullable(a.summary.pri_min_us, b.summary.pri_min_us, dir);
    case "pri_max":
      return compareNullable(a.summary.pri_max_us, b.summary.pri_max_us, dir);
    case "scan_min":
      return compareNullable(a.summary.scan_min, b.summary.scan_min, dir);
    case "scan_max":
      return compareNullable(a.summary.scan_max, b.summary.scan_max, dir);
    case "modes_passing":
      return compareNullable(a.summary.modes_passing, b.summary.modes_passing, dir);
  }
}

/** No filter applied when both ends are blank. Otherwise an Emitter matches
 * only if it actually has data for this parameter AND that data's range
 * overlaps the filter range at all. */
function rangeOverlaps(filterMin: string, filterMax: string, valueMin: number | null, valueMax: number | null): boolean {
  if (!filterMin && !filterMax) return true;
  if (valueMin == null || valueMax == null) return false;
  const fMin = filterMin ? Number(filterMin) : -Infinity;
  const fMax = filterMax ? Number(filterMax) : Infinity;
  return valueMin <= fMax && valueMax >= fMin;
}

export function EmittersListPage() {
  const { data: emitters, isLoading, error } = useEmitters();
  const createEmitter = useCreateEmitter();
  const deleteEmitter = useDeleteEmitter();
  const { confirmDelete, dialog } = useConfirmDialog();
  const navigate = useNavigate();
  const [showAddModal, setShowAddModal] = useState(false);
  const [name, setName] = useState("");
  const [designation, setDesignation] = useState("");
  const [description, setDescription] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const [nameFilter, setNameFilter] = useState("");
  const [designationFilter, setDesignationFilter] = useState("");
  const [rfMin, setRfMin] = useState("");
  const [rfMax, setRfMax] = useState("");
  const [pwMin, setPwMin] = useState("");
  const [pwMax, setPwMax] = useState("");
  const [priMin, setPriMin] = useState("");
  const [priMax, setPriMax] = useState("");
  const [scanMin, setScanMin] = useState("");
  const [scanMax, setScanMax] = useState("");

  const filtered = (emitters ?? []).filter((e) => {
    const nameQ = nameFilter.trim().toLowerCase();
    if (nameQ && !e.name.toLowerCase().includes(nameQ)) return false;
    const designationQ = designationFilter.trim().toLowerCase();
    if (designationQ && !(e.designation ?? "").toLowerCase().includes(designationQ)) return false;
    if (!rangeOverlaps(rfMin, rfMax, e.summary.rf_min_mhz, e.summary.rf_max_mhz)) return false;
    if (!rangeOverlaps(pwMin, pwMax, e.summary.pw_min_us, e.summary.pw_max_us)) return false;
    if (!rangeOverlaps(priMin, priMax, e.summary.pri_min_us, e.summary.pri_max_us)) return false;
    if (!rangeOverlaps(scanMin, scanMax, e.summary.scan_min, e.summary.scan_max)) return false;
    return true;
  });

  const { sorted, sortKey, sortDir, onSort, onClear } = useSortableTable(filtered, compareEmitters);

  const header = (label: string, key: EmitterSortKey, columnType?: "string" | "number" | "date") => (
    <SortableColumnHeader
      label={label}
      columnKey={key}
      columnType={columnType}
      activeKey={sortKey}
      activeDir={sortDir}
      onSort={onSort}
      onClear={onClear}
    />
  );

  function resetFilters() {
    setNameFilter("");
    setDesignationFilter("");
    setRfMin("");
    setRfMax("");
    setPwMin("");
    setPwMax("");
    setPriMin("");
    setPriMax("");
    setScanMin("");
    setScanMax("");
  }

  async function handleDelete(emitter: Emitter) {
    if (await confirmDelete(`Delete Emitter "${emitter.name}"? It can be restored from Recently Deleted for 30 days.`)) {
      await deleteEmitter.mutateAsync({ id: emitter.id });
    }
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    try {
      const emitter = await createEmitter.mutateAsync({
        name,
        designation: designation || undefined,
        description: description || undefined,
      });
      setName("");
      setDesignation("");
      setDescription("");
      setShowAddModal(false);
      navigate(`/emitters/${emitter.id}`);
    } catch (err) {
      setFormError(err instanceof ApiRequestError ? err.message : "Failed to create emitter");
    }
  }

  return (
    <div className="page">
      <div className="page-header-row">
        <h1>Emitters</h1>
        <RequireRole minimum="editor">
          <button onClick={() => setShowAddModal(true)}>+ Add Emitter</button>
        </RequireRole>
      </div>

      {showAddModal && (
        <Modal title="Add Emitter" onClose={() => setShowAddModal(false)}>
          <form onSubmit={handleCreate}>
            <div className="form-row">
              <input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
            </div>
            <div className="form-row">
              <input
                placeholder="Designation (optional)"
                value={designation}
                onChange={(e) => setDesignation(e.target.value)}
              />
            </div>
            <div className="form-row">
              <label className="wide-label">
                Description (optional)
                <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
              </label>
            </div>
            {formError && <div className="error-text">{formError}</div>}
            <div className="modal-actions">
              <button type="button" className="icon-button" onClick={() => setShowAddModal(false)}>
                Cancel
              </button>
              <button type="submit" disabled={createEmitter.isPending}>
                Add Emitter
              </button>
            </div>
          </form>
        </Modal>
      )}

      {error && <div className="error-text">{(error as Error).message}</div>}

      <div className="card">
        <div className="modes-toolbar-row">
          <input
            type="text"
            placeholder="Filter by name…"
            value={nameFilter}
            onChange={(e) => setNameFilter(e.target.value)}
          />
          <input
            type="text"
            placeholder="Filter by designation…"
            value={designationFilter}
            onChange={(e) => setDesignationFilter(e.target.value)}
          />
          <label>
            RF (MHz)
            <input type="number" step="any" placeholder="min" value={rfMin} onChange={(e) => setRfMin(e.target.value)} />
            <input type="number" step="any" placeholder="max" value={rfMax} onChange={(e) => setRfMax(e.target.value)} />
          </label>
          <label>
            PW (µs)
            <input type="number" step="any" placeholder="min" value={pwMin} onChange={(e) => setPwMin(e.target.value)} />
            <input type="number" step="any" placeholder="max" value={pwMax} onChange={(e) => setPwMax(e.target.value)} />
          </label>
          <label>
            PRI (µs)
            <input type="number" step="any" placeholder="min" value={priMin} onChange={(e) => setPriMin(e.target.value)} />
            <input type="number" step="any" placeholder="max" value={priMax} onChange={(e) => setPriMax(e.target.value)} />
          </label>
          <label>
            Scan
            <input type="number" step="any" placeholder="min" value={scanMin} onChange={(e) => setScanMin(e.target.value)} />
            <input type="number" step="any" placeholder="max" value={scanMax} onChange={(e) => setScanMax(e.target.value)} />
          </label>
          <button type="button" className="link-button" onClick={resetFilters}>
            Reset filters
          </button>
        </div>
        <p className="hint-text">
          RF/PW/PRI filters match an Emitter if any of its approved Modes falls within the given range. Scan
          filters match against the Emitter's EW Groups directly.
        </p>
      </div>

      {isLoading ? (
        <LoadingState label="Loading emitters…" />
      ) : (emitters ?? []).length === 0 ? (
        <EmptyState
          icon="◇"
          title="No Emitters yet"
          message="Emitters are the top-level RF profile — add one above to start building EW Groups, Sources, and Modes."
        />
      ) : sorted.length === 0 ? (
        <EmptyState icon="◇" title="No matches" message="No Emitters match the current search/filters." />
      ) : (
        <div className="matrix-scroll">
        <table className="data-table">
          <thead>
            <tr>
              {header("Name", "name")}
              {header("Designation", "designation")}
              {header("Status", "status")}
              {header("RF min", "rf_min", "number")}
              {header("RF max", "rf_max", "number")}
              {header("PW min", "pw_min", "number")}
              {header("PW max", "pw_max", "number")}
              {header("PRI min", "pri_min", "number")}
              {header("PRI max", "pri_max", "number")}
              {header("Scan min", "scan_min", "number")}
              {header("Scan max", "scan_max", "number")}
              {header("Modes passing", "modes_passing", "number")}
              <th></th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((e) => (
              <tr key={e.id}>
                <td>
                  <Link to={`/emitters/${e.id}`}>{e.name}</Link>
                </td>
                <td>{e.designation ?? "—"}</td>
                <td>
                  <span className={`status-badge status-${e.status}`}>{emitterStatusLabel(e.status)}</span>
                </td>
                <td>{e.summary.rf_min_mhz ?? "—"}</td>
                <td>{e.summary.rf_max_mhz ?? "—"}</td>
                <td>{e.summary.pw_min_us ?? "—"}</td>
                <td>{e.summary.pw_max_us ?? "—"}</td>
                <td>{e.summary.pri_min_us ?? "—"}</td>
                <td>{e.summary.pri_max_us ?? "—"}</td>
                <td>{e.summary.scan_min ?? "—"}</td>
                <td>{e.summary.scan_max ?? "—"}</td>
                <td>
                  {e.summary.mode_count > 0 ? `${e.summary.modes_passing} / ${e.summary.mode_count}` : "—"}
                </td>
                <td>
                  <RequireRole minimum="editor">
                    <button className="link-button" onClick={() => void handleDelete(e)}>
                      Delete
                    </button>
                  </RequireRole>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
      {dialog}
    </div>
  );
}
