import { useState, type FormEvent } from "react";
import { useCreateSource, useUpdateSource } from "../../state/hooks/useSources";
import { useSourceGroups } from "../../state/hooks/useSourceGroups";
import { ApiRequestError } from "../../api/client";
import type { Source } from "../../types/domain";

export function SourceForm({
  emitterId,
  initialData,
  onClose,
}: {
  emitterId: string;
  initialData?: Source | null;
  onClose?: () => void;
}) {
  const createSource = useCreateSource(emitterId);
  const updateSource = useUpdateSource(emitterId);
  const { sourceGroups } = useSourceGroups();
  const [name, setName] = useState(initialData?.name ?? "");
  const [description, setDescription] = useState(initialData?.description ?? "");
  const [sourceDate, setSourceDate] = useState(initialData?.source_date ?? "");
  const [groupId, setGroupId] = useState(initialData?.group_id ?? "");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      if (initialData) {
        await updateSource.mutateAsync({
          sourceId: initialData.id,
          input: {
            name,
            description: description || null,
            source_date: sourceDate,
            group_id: groupId || null,
          },
        });
      } else {
        await createSource.mutateAsync({
          name,
          description: description || undefined,
          source_date: sourceDate,
          group_id: groupId || undefined,
        });
      }
      if (onClose) {
        onClose();
      } else {
        setName("");
        setDescription("");
        setSourceDate("");
        setGroupId("");
      }
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Failed to save Source");
    }
  }

  const isPending = createSource.isPending || updateSource.isPending;

  return (
    <form className="card inline-form" onSubmit={handleSubmit}>
      <input placeholder="Source name" value={name} onChange={(e) => setName(e.target.value)} required />
      <input placeholder="Description" value={description} onChange={(e) => setDescription(e.target.value)} />
      <label className="inline-date-label">
        Date last updated
        <input type="date" value={sourceDate} onChange={(e) => setSourceDate(e.target.value)} required />
      </label>
      <select value={groupId} onChange={(e) => setGroupId(e.target.value)}>
        <option value="">No group</option>
        {sourceGroups.map((g) => (
          <option key={g.id} value={g.id}>
            {g.name}
          </option>
        ))}
      </select>
      <button type="submit" disabled={isPending}>
        {initialData ? "Update Source" : "Add Source"}
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
