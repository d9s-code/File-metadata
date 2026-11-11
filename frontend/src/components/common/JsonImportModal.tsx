import { useState, useRef } from "react";
import { DateInput } from "./DateInput";
import { Modal } from "./Modal";
import { emittersApi, type JsonImportResult } from "../../api/emitters";
import { ApiRequestError } from "../../api/client";
import { useSourceGroups } from "../../state/hooks/useSourceGroups";

interface JsonImportModalProps {
  emitterId: string;
  onSuccess: () => void;
  onClose: () => void;
}

export function JsonImportModal({
  emitterId,
  onSuccess,
  onClose,
}: JsonImportModalProps) {
  const [isImporting, setIsImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Shown instead of closing when some of the file was left out.
  const [done, setDone] = useState<JsonImportResult | null>(null);
  const [sourceDate, setSourceDate] = useState("");
  const [groupId, setGroupId] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { sourceGroups } = useSourceGroups();

  const handleImport = async (file: File) => {
    setIsImporting(true);
    setError(null);
    try {
      const result = await emittersApi.importJson(emitterId, file, sourceDate || undefined, groupId || undefined);
      onSuccess();
      if (result?.skipped?.length) setDone(result);
      else onClose();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Failed to import JSON");
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <Modal title="Import JSON" onClose={onClose} wide>
      {done ? (
        <div className="json-import-done">
          <p>
            Imported {done.source_count} Source{done.source_count === 1 ? "" : "s"} with {done.element_count} Element
            {done.element_count === 1 ? "" : "s"} and {done.sequence_count} sequence{done.sequence_count === 1 ? "" : "s"}.
          </p>
          <p className="hint-text">
            {done.skipped.length} thing{done.skipped.length === 1 ? "" : "s"} in the file couldn&apos;t be read and{" "}
            {done.skipped.length === 1 ? "was" : "were"} left out:
          </p>
          <ul className="json-import-skipped">
            {done.skipped.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
          <div className="modal-actions">
            <button type="button" className="button primary" onClick={onClose}>
              Done
            </button>
          </div>
        </div>
      ) : (
      <div className="card" style={{ margin: 0, borderRadius: 0 }}>
        <div style={{ padding: "1rem" }}>
          <p className="hint-text">
            Upload a JSON file to populate this Emitter with new sources.
          </p>

          <label className="wide-label" style={{ marginTop: "1rem", display: "block" }}>
            Date last updated (optional)
            <DateInput
              value={sourceDate}
              onChange={(e) => setSourceDate(e.target.value)}
              disabled={isImporting}
            />
          </label>
          <p className="hint-text" style={{ marginTop: "0.25rem" }}>
            If set, every Source created by this import uses this date instead of
            whatever (if anything) the JSON file's own per-set date parses to.
          </p>

          <label className="wide-label" style={{ marginTop: "1rem", display: "block" }}>
            Source Group (optional)
            <select value={groupId} onChange={(e) => setGroupId(e.target.value)} disabled={isImporting}>
              <option value="">— create a new group for this import —</option>
              {sourceGroups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </label>
          <p className="hint-text" style={{ marginTop: "0.25rem" }}>
            If set, every Source created by this import is filed under this existing group
            instead of a new one created automatically for this import.
          </p>

          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginTop: "1rem" }}>
            <input
              type="file"
              ref={fileInputRef}
              accept=".json"
              style={{ display: "none" }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  handleImport(file);
                  e.target.value = ""; // reset
                }
              }}
            />
            <button
              className="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isImporting}
            >
              {isImporting ? "Importing…" : "Select JSON file"}
            </button>
            {error && <span className="error-text" style={{ fontSize: "0.8rem" }}>{error}</span>}
          </div>
        </div>
      </div>
      )}
    </Modal>
  );
}
