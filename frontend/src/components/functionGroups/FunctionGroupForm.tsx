import { useState, useEffect, type FormEvent } from "react";
import { useCreateFunctionGroup, useUpdateFunctionGroup } from "../../state/hooks/useFunctionGroups";
import { ApiRequestError } from "../../api/client";
import type { FunctionGroup } from "../../types/domain";

interface FunctionGroupFormProps {
  emitterId: string;
  initialData?: FunctionGroup | null;
  onClose?: () => void;
}

export function FunctionGroupForm({ emitterId, initialData, onClose }: FunctionGroupFormProps) {
  const createFunctionGroup = useCreateFunctionGroup(emitterId);
  const updateFunctionGroup = useUpdateFunctionGroup(emitterId);

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
        await updateFunctionGroup.mutateAsync({ functionGroupId: initialData.id, input: { name } });
      } else {
        await createFunctionGroup.mutateAsync({ name });
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

  const isPending = createFunctionGroup.isPending || updateFunctionGroup.isPending;

  return (
    <form className="card inline-form" onSubmit={handleSubmit}>
      <input
        placeholder="Function Group name — e.g. Search, Track, Guidance"
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
      />
      <button type="submit" disabled={isPending}>
        {initialData ? "Update Function Group" : "Add Function Group"}
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
