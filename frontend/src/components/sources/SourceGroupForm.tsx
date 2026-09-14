import { useState, type FormEvent } from "react";
import { useSourceGroups } from "../../state/hooks/useSourceGroups";
import { ApiRequestError } from "../../api/client";

export function SourceGroupForm({ onClose }: { onClose: () => void }) {
  const { createGroup } = useSourceGroups();
  
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await createGroup({
        name,
        description: description || undefined,
      });
      setName("");
      setDescription("");
      onClose();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Failed to create Source Group");
    }
  }

  return (
    <form className="card inline-form" onSubmit={handleSubmit}>
      <input 
        placeholder="Group name" 
        value={name} 
        onChange={(e) => setName(e.target.value)} 
        required 
      />
      <textarea 
        placeholder="Description (optional)" 
        value={description} 
        onChange={(e) => setDescription(e.target.value)}
        style={{ width: '100%', minHeight: '60px', padding: '0.4rem', borderRadius: '4px', border: '1px solid #ccc', fontFamily: 'inherit' }}
      />
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <button type="submit" disabled={false}>
          Create Group
        </button>
        <button type="button" className="link-button" onClick={onClose}>
          Cancel
        </button>
      </div>
      {error && <div className="error-text">{error}</div>}
    </form>
  );
}
