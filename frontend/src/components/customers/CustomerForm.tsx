import { useState, useEffect, type FormEvent } from "react";
import { useCreateCustomer, useUpdateCustomer } from "../../state/hooks/useCustomers";
import { ApiRequestError } from "../../api/client";
import type { Customer } from "../../api/customers";

interface CustomerFormProps {
  initialData?: Customer | null;
  onClose?: () => void;
}

export function CustomerForm({ initialData, onClose }: CustomerFormProps) {
  const createCustomer = useCreateCustomer();
  const updateCustomer = useUpdateCustomer();

  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setName(initialData ? initialData.name : "");
  }, [initialData]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      if (initialData) {
        await updateCustomer.mutateAsync({ customerId: initialData.id, input: { name } });
      } else {
        await createCustomer.mutateAsync({ name });
      }

      if (onClose) {
        onClose();
      } else {
        setName("");
      }
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Operation failed");
    }
  }

  const isPending = createCustomer.isPending || updateCustomer.isPending;

  return (
    <form className="card inline-form" onSubmit={handleSubmit}>
      <input placeholder="Customer name" value={name} onChange={(e) => setName(e.target.value)} required />
      <button type="submit" disabled={isPending}>
        {initialData ? "Update Customer" : "Add Customer"}
      </button>
      {onClose && (
        <button type="button" className="icon-button" onClick={() => onClose()}>
          Cancel
        </button>
      )}
      {error && <div className="error-text">{error}</div>}
    </form>
  );
}
