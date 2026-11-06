import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { ApiRequestError } from "../../api/client";
import { mdfsApi, type Mdf } from "../../api/mdfs";
import type { MdfVersionSummary } from "../../api/mdfVersions";
import { useCustomers } from "../../state/hooks/useCustomers";
import { mdfsKey } from "../../state/hooks/useMdfs";
import { Modal } from "../common/Modal";
import { DateInput } from "../common/DateInput";
import { formatDate } from "../common/dates";

/** New MDF from this one: the next release as a separate MDF — its own name,
 * customer and id — starting from a saved version of this one (by default
 * the version it went out as) and following it, so its changelog counts
 * from there. */
export function NewMdfFromDialog({
  mdf,
  versions,
  onClose,
}: {
  mdf: Mdf;
  versions: MdfVersionSummary[];
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: customers } = useCustomers();
  const [name, setName] = useState("");
  const [customerId, setCustomerId] = useState(mdf.customer_id ?? "");
  const [dueDate, setDueDate] = useState("");
  const [version, setVersion] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setError(null);
    setSaving(true);
    try {
      const created = await mdfsApi.newFrom(mdf.id, {
        name: name.trim(),
        customer_id: customerId || null,
        due_date: dueDate || null,
        version: version ? Number(version) : null,
      });
      await qc.invalidateQueries({ queryKey: mdfsKey });
      navigate(`/mdfs/${created.id}`);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Couldn't make the new MDF");
      setSaving(false);
    }
  }

  return (
    <Modal title="New MDF from this one" onClose={onClose}>
      <form onSubmit={(e) => void submit(e)} className="edit-fields">
        <p className="hint-text">
          The next release as a separate MDF, with its own name, customer and id. It starts with the Platforms and dwell
          files of the version picked, saved as its v1, and follows <strong>{mdf.name}</strong>: its summary and release
          notes count what changed since that version. Notes, goals, the progress log, files and test history stay
          here.
        </p>
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
        </label>
        <label>
          Customer
          <select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
            <option value="">— none —</option>
            {(customers ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Start from
          <select value={version} onChange={(e) => setVersion(e.target.value)}>
            <option value="">The version it went out as (else the latest)</option>
            {[...versions].reverse().map((v) => (
              <option key={v.id} value={v.version_number}>
                v{v.version_number} · {formatDate(v.created_at)}
                {v.change_summary ? ` — ${v.change_summary}` : ""}
              </option>
            ))}
          </select>
        </label>
        <label>
          Due date (optional)
          <DateInput value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </label>
        {error && <div className="error-text">{error}</div>}
        <div className="modal-actions">
          <button type="button" className="button secondary" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="submit" className="button primary" disabled={saving || !name.trim() || versions.length === 0}>
            {saving ? "Making it…" : "Make the new MDF"}
          </button>
        </div>
        {versions.length === 0 && <p className="hint-text">Save a version of this MDF first.</p>}
      </form>
    </Modal>
  );
}
