import { useState } from "react";
import { MenuButton } from "../components/common/MenuButton";
import { MDFS_SECTION, PageHeader } from "../components/common/PageHeader";
import { useCustomers, useDeleteCustomer } from "../state/hooks/useCustomers";
import { CustomerForm } from "../components/customers/CustomerForm";
import { RequireRole } from "../auth/RequireAuth";
import { LoadingState } from "../components/common/LoadingState";
import { EmptyState } from "../components/common/EmptyState";
import { useConfirmDialog } from "../components/common/ConfirmDialog";
import { ApiRequestError } from "../api/client";
import type { Customer } from "../api/customers";

export function CustomersPage() {
  const { data: customers, isLoading } = useCustomers();
  const deleteCustomer = useDeleteCustomer();
  const [showForm, setShowForm] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const { confirmDelete, dialog } = useConfirmDialog();

  async function handleDelete(customer: Customer) {
    setDeleteError(null);
    if (!(await confirmDelete(`Delete Customer "${customer.name}"? Any MDFs assigned to it become unassigned.`))) return;
    try {
      await deleteCustomer.mutateAsync(customer.id);
    } catch (err) {
      setDeleteError(err instanceof ApiRequestError ? err.message : "Failed to delete Customer");
    }
  }

  return (
    <div className="page">
      <PageHeader
        title="Customers"
        section={MDFS_SECTION}
        info="Who an MDF is delivered to — pick from this list on an MDF instead of typing a name freely, so sorting and filtering the MDFs by customer stays consistent."
      >
        <RequireRole minimum="editor">
          <button onClick={() => setShowForm((v) => !v)}>{showForm ? "Cancel" : "+ Add Customer"}</button>
        </RequireRole>
      </PageHeader>

      {showForm && <CustomerForm onClose={() => setShowForm(false)} />}
      {deleteError && <div className="error-text">{deleteError}</div>}

      {isLoading ? (
        <LoadingState label="Loading customers…" />
      ) : customers && customers.length === 0 ? (
        <EmptyState icon="◇" title="No Customers yet" message="Add one above, then pick it from an MDF's edit form." />
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th className="row-actions" aria-label="Actions"></th>
            </tr>
          </thead>
          <tbody>
            {(customers ?? []).map((c) =>
              editingCustomer?.id === c.id ? (
                <tr key={c.id}>
                  <td colSpan={2}>
                    <CustomerForm initialData={c} onClose={() => setEditingCustomer(null)} />
                  </td>
                </tr>
              ) : (
                <tr key={c.id}>
                  <td>{c.name}</td>
                  <td className="row-actions">
                    <RequireRole minimum="editor">
                      <MenuButton
                        label="⋯"
                        className="row-menu-button"
                        ariaLabel={`Actions for ${c.name}`}
                        items={[
                          { label: "Edit", onSelect: () => setEditingCustomer(c) },
                          { label: "Delete…", danger: true, onSelect: () => void handleDelete(c) },
                        ]}
                      />
                    </RequireRole>
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      )}
      {dialog}
    </div>
  );
}
