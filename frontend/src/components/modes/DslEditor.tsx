import { useState, type FormEvent } from "react";
import { useCreateModeFromDsl } from "../../state/hooks/useModes";
import { ApiRequestError } from "../../api/client";
import type { EwGroup } from "../../types/domain";

export function DslEditor({
  emitterId,
  sourceId,
  ewGroups,
}: {
  emitterId: string;
  sourceId: string;
  ewGroups: EwGroup[];
}) {
  const [ewGroupId, setEwGroupId] = useState(ewGroups[0]?.id ?? "");
  const createFromDsl = useCreateModeFromDsl(ewGroupId, emitterId);
  const [name, setName] = useState("");
  const [dslText, setDslText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    if (!ewGroupId) {
      setError("Choose a target EW Group first.");
      return;
    }
    try {
      const mode = await createFromDsl.mutateAsync({ source_id: sourceId, name, dsl_text: dslText });
      setSuccess(`Created "${mode.name}" — elements derived and added to this Source's pool.`);
      setName("");
      setDslText("");
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Failed to parse/create mode line");
    }
  }

  return (
    <form className="card dsl-editor" onSubmit={handleSubmit}>
      <h5>Write a mode line directly</h5>
      <p className="hint-text">
        e.g. <code>RF 2900-3100 PRI FIXED 800-1200 JITTER 5-15 PW 0.5-1.2</code> — elements are derived
        automatically and added to this Source's element pool.
      </p>
      <div className="form-row">
        <input placeholder="Mode name" value={name} onChange={(e) => setName(e.target.value)} required />
        <select value={ewGroupId} onChange={(e) => setEwGroupId(e.target.value)}>
          <option value="" disabled>
            Target EW Group…
          </option>
          {ewGroups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
      </div>
      <textarea
        placeholder="RF 2900-3100 PRI FIXED 800-1200 JITTER 5-15 PW 0.5-1.2"
        value={dslText}
        onChange={(e) => setDslText(e.target.value)}
        rows={2}
        required
      />
      <button type="submit" disabled={createFromDsl.isPending}>
        Add Mode from DSL
      </button>
      {success && <p className="hint-text success-text">{success}</p>}
      {error && <div className="error-text">{error}</div>}
    </form>
  );
}
