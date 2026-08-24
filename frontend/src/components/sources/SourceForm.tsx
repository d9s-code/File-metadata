import { useState, type FormEvent } from "react";
import { useCreateSource } from "../../state/hooks/useSources";
import { ApiRequestError } from "../../api/client";

export function SourceForm({ emitterId }: { emitterId: string }) {
  const createSource = useCreateSource(emitterId);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [sourceDate, setSourceDate] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await createSource.mutateAsync({ name, description: description || undefined, source_date: sourceDate });
      setName("");
      setDescription("");
      setSourceDate("");
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Failed to create Source");
    }
  }

  return (
    <form className="card inline-form" onSubmit={handleSubmit}>
      <input placeholder="Source name" value={name} onChange={(e) => setName(e.target.value)} required />
      <input placeholder="Description" value={description} onChange={(e) => setDescription(e.target.value)} />
      <label className="inline-date-label">
        Date last updated
        <input type="date" value={sourceDate} onChange={(e) => setSourceDate(e.target.value)} required />
      </label>
      <button type="submit" disabled={createSource.isPending}>
        Add Source
      </button>
      {error && <div className="error-text">{error}</div>}
    </form>
  );
}
