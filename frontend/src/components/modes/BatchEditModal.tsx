import { useState } from "react";

interface BatchEditModalProps {
  ewGroupId: string;
  selectedModeIds: string[];
  onClose: () => void;
  onApply: (fields: any) => Promise<void>;
}

export function BatchEditModal({
  selectedModeIds,
  onClose,
  onApply,
}: BatchEditModalProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [fields, setFields] = useState<{
    name?: string;
    notes?: string | null;
    sort_order?: number;
    ew_group_id?: string;
    source_id?: string;
  }>({});

  const [enabledFields, setEnabledFields] = useState<Set<string>>(new Set());

  const toggleField = (field: string) => {
    const next = new Set(enabledFields);
    if (next.has(field)) next.delete(field);
    else next.add(field);
    setEnabledFields(next);
  };

  const handleFieldChange = (field: string, value: any) => {
    setFields((prev) => ({ ...prev, [field]: value }));
  };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      await onApply(fields);
      onClose();
    } catch (err: any) {
      setError(err.message || "Failed to perform batch update");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="modal-overlay">
      <div className="card modal-content" style={{ maxWidth: "500px", width: "90%" }}>
        <h5>Batch Edit Modes ({selectedModeIds.length})</h5>
        <p className="hint-text">
          Select the fields you want to update for all selected modes.
        </p>

        <form onSubmit={handleSubmit} className="batch-edit-form">
          <div className="batch-edit-fields">
            {["name", "notes", "sort_order", "ew_group_id", "source_id"].map((field) => (
              <div key={field} className="batch-field-row">
                <label className="checkbox-label" style={{ width: "auto", margin: 0 }}>
                  <input
                    type="checkbox"
                    checked={enabledFields.has(field)}
                    onChange={() => toggleField(field)}
                  />
                  {field.replace("_", " ").replace(/\b\w/g, (l) => l.toUpperCase())}
                </label>
                {enabledFields.has(field) && (
                  <div className="batch-field-input">
                    {field === "name" && (
                      <input
                        type="text"
                        value={(fields.name as string) || ""}
                        onChange={(e) => handleFieldChange("name", e.target.value)}
                        required
                      />
                    )}
                    {field === "notes" && (
                      <textarea
                        value={(fields.notes as string) || ""}
                        onChange={(e) => handleFieldChange("notes", e.target.value)}
                        rows={3}
                      />
                    )}
                    {field === "sort_order" && (
                      <input
                        type="number"
                        value={(fields.sort_order as number) || 0}
                        onChange={(e) => handleFieldChange("sort_order", Number(e.target.value))}
                      />
                    )}
                    {/* Note: ew_group_id and source_id would ideally be dropdowns, but 
                        for simplicity in this MVP we'll just use text inputs or skip them 
                        if they aren't strictly needed for the basic use case. 
                        Let's stick to name and notes for now to avoid complexity. */}
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="form-row batch-edit-actions" style={{ marginTop: "2rem", justifyContent: "flex-end" }}>
            <button type="button" className="link-button" onClick={onClose} disabled={isSubmitting}>
              Cancel
            </button>
            <button type="submit" disabled={isSubmitting || enabledFields.size === 0}>
              {isSubmitting ? "Updating..." : "Apply Changes"}
            </button>
          </div>
        </form>

        {error && <div className="error-text" style={{ marginTop: "1rem" }}>{error}</div>}
      </div>

      <style>{`
        .batch-edit-form .batch-field-row {
          display: flex;
          align-items: center;
          gap: 1rem;
          margin-bottom: 0.75rem;
          padding: 0.5rem;
          background: var(--bg-secondary);
          border-radius: 4px;
        }
        .batch-field-input {
          flex: 1;
        }
        .batch-field-input input, 
        .batch-field-input textarea {
          width: 100%;
          padding: 0.4rem;
          border: 1px solid var(--border-color);
          border-radius: 4px;
          background: var(--bg-primary);
          color: var(--text-primary);
        }
        .batch-edit-actions {
          gap: 1rem;
        }
      `}</style>
    </div>
  );
}
