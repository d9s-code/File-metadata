import { useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useCreateMdf, useDeleteMdf, useMdfs } from "../state/hooks/useMdfs";
import { useCustomers } from "../state/hooks/useCustomers";
import { RequireRole } from "../auth/RequireAuth";
import { ApiRequestError } from "../api/client";
import { LoadingState } from "../components/common/LoadingState";
import { EmptyState } from "../components/common/EmptyState";
import { Modal } from "../components/common/Modal";
import { SortableColumnHeader } from "../components/common/SortableColumnHeader";
import { useSortableTable } from "../components/common/useSortableTable";
import { compareNullable, compareStrings } from "../components/common/sortUtils";
import { useConfirmDialog } from "../components/common/ConfirmDialog";
import type { Customer } from "../api/customers";
import type { Mdf } from "../api/mdfs";
import { statusLabel } from "../components/common/emitterStatusLabel";

type MdfSortKey = "name" | "platforms" | "release_date" | "status" | "customer";

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function compareMdfs(
  a: Mdf,
  b: Mdf,
  key: MdfSortKey,
  dir: "asc" | "desc",
  customersById: Record<string, Customer>,
): number {
  switch (key) {
    case "name":
      return compareStrings(a.name, b.name, dir);
    case "platforms":
      return compareNullable(a.platforms_count, b.platforms_count, dir);
    case "release_date":
      return compareNullable(a.release_date, b.release_date, dir);
    case "status":
      return compareStrings(a.status, b.status, dir);
    case "customer":
      return compareStrings(
        a.customer_id ? customersById[a.customer_id]?.name : null,
        b.customer_id ? customersById[b.customer_id]?.name : null,
        dir,
      );
  }
}

export function MdfsListPage() {
  const { data: mdfs, isLoading } = useMdfs();
  const { data: customers } = useCustomers();
  const customersById = useMemo(
    () => Object.fromEntries((customers ?? []).map((c) => [c.id, c])),
    [customers],
  );
  const comparator = useMemo(
    () => (a: Mdf, b: Mdf, key: MdfSortKey, dir: "asc" | "desc") => compareMdfs(a, b, key, dir, customersById),
    [customersById],
  );
  const { sorted, sortKey, sortDir, onSort, onClear } = useSortableTable(mdfs ?? [], comparator);
  const createMdf = useCreateMdf();
  const deleteMdf = useDeleteMdf();
  const { confirmDelete, dialog } = useConfirmDialog();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [releaseDate, setReleaseDate] = useState(todayDate());
  const [customerId, setCustomerId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [filter, setFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [customerFilter, setCustomerFilter] = useState("");
  const navigate = useNavigate();

  async function handleDelete(mdf: Mdf) {
    if (await confirmDelete(`Delete MDF "${mdf.name}"? It can be restored from Recently Deleted for 30 days.`)) {
      await deleteMdf.mutateAsync({ id: mdf.id });
    }
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const mdf = await createMdf.mutateAsync({
        name,
        description: description || undefined,
        release_date: releaseDate || undefined,
        customer_id: customerId || undefined,
      });
      setName("");
      setDescription("");
      setReleaseDate(todayDate());
      setCustomerId("");
      setShowAdd(false);
      navigate(`/mdfs/${mdf.id}`);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Failed to create MDF");
    }
  }

  const query = filter.trim().toLowerCase();
  const visible = sorted.filter(
    (m) =>
      (!query || `${m.name} ${m.description ?? ""}`.toLowerCase().includes(query)) &&
      (!statusFilter || m.status === statusFilter) &&
      (!customerFilter || m.customer_id === customerFilter),
  );
  const statuses = [...new Set((mdfs ?? []).map((m) => m.status))].sort();

  return (
    <div className="page">
      <div className="page-header-row">
        <h1>Mission Data Files</h1>
        <RequireRole minimum="editor">
          <button onClick={() => setShowAdd(true)}>+ Add MDF</button>
        </RequireRole>
      </div>
      <p className="hint-text">An MDF pins saved Platform versions for delivery to a customer.</p>

      {showAdd && (
        <Modal title="Add MDF" onClose={() => setShowAdd(false)}>
          <form onSubmit={handleCreate}>
            <div className="form-row">
              <input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
            </div>
            <div className="form-row">
              <label className="wide-label">
                Description (optional)
                <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
              </label>
            </div>
            <div className="form-row">
              <label className="wide-label">
                Release date
                <input type="date" value={releaseDate} onChange={(e) => setReleaseDate(e.target.value)} />
              </label>
              <label className="wide-label">
                Customer
                <select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                  <option value="">— no customer —</option>
                  {(customers ?? []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {error && <div className="error-text">{error}</div>}
            <div className="modal-actions">
              <button type="button" className="button secondary" onClick={() => setShowAdd(false)}>
                Cancel
              </button>
              <button type="submit" className="button primary" disabled={createMdf.isPending}>
                Add MDF
              </button>
            </div>
          </form>
        </Modal>
      )}

      {mdfs && mdfs.length > 0 && (
        <div className="card">
          <div className="modes-toolbar-row">
            <input placeholder="Filter by name or description…" value={filter} onChange={(e) => setFilter(e.target.value)} />
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Status">
              <option value="">All statuses</option>
              {statuses.map((st) => (
                <option key={st} value={st}>
                  {statusLabel(st)}
                </option>
              ))}
            </select>
            {(customers ?? []).length > 0 && (
              <select value={customerFilter} onChange={(e) => setCustomerFilter(e.target.value)} aria-label="Customer">
                <option value="">All customers</option>
                {(customers ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            )}
            <button
              type="button"
              className="link-button"
              onClick={() => {
                setFilter("");
                setStatusFilter("");
                setCustomerFilter("");
              }}
            >
              Reset filters
            </button>
          </div>
        </div>
      )}

      {isLoading ? (
        <LoadingState label="Loading MDFs…" />
      ) : mdfs && mdfs.length === 0 ? (
        <EmptyState icon="◇" title="No MDFs yet" message="Add one with + Add MDF, then pin saved Platform versions to it." />
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <SortableColumnHeader
                label="Name"
                columnKey="name"
                activeKey={sortKey}
                activeDir={sortDir}
                onSort={onSort}
                onClear={onClear}
              />
              <SortableColumnHeader
                label="Platforms"
                columnKey="platforms"
                columnType="number"
                activeKey={sortKey}
                activeDir={sortDir}
                onSort={onSort}
                onClear={onClear}
              />
              <SortableColumnHeader
                label="Release date"
                columnKey="release_date"
                columnType="date"
                activeKey={sortKey}
                activeDir={sortDir}
                onSort={onSort}
                onClear={onClear}
              />
              <SortableColumnHeader
                label="Status"
                columnKey="status"
                activeKey={sortKey}
                activeDir={sortDir}
                onSort={onSort}
                onClear={onClear}
              />
              <SortableColumnHeader
                label="Customer"
                columnKey="customer"
                activeKey={sortKey}
                activeDir={sortDir}
                onSort={onSort}
                onClear={onClear}
              />
              <th></th>
            </tr>
          </thead>
          <tbody>
            {visible.map((m) => (
              <tr key={m.id}>
                <td>
                  <Link to={`/mdfs/${m.id}`}>{m.name}</Link>
                </td>
                <td>{m.platforms_count}</td>
                <td>{m.release_date ?? "—"}</td>
                <td>
                  <span className={`status-badge status-${m.status}`}>{statusLabel(m.status)}</span>
                </td>
                <td>{m.customer_id ? customersById[m.customer_id]?.name ?? "—" : "—"}</td>
                <td>
                  <RequireRole minimum="editor">
                    <button className="link-button link-button-danger" onClick={() => void handleDelete(m)}>
                      Delete
                    </button>
                  </RequireRole>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {dialog}
    </div>
  );
}
