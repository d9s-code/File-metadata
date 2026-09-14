import { useState, useRef } from "react";
import { Modal } from "./Modal";
import { emittersApi } from "../../api/emitters";
import { ApiRequestError } from "../../api/client";

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
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImport = async (file: File) => {
    setIsImporting(true);
    setError(null);
    try {
      await emittersApi.importJson(emitterId, file);
      onSuccess();
      onClose();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Failed to import JSON");
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <Modal title="Import JSON" onClose={onClose} wide>
      <div className="card" style={{ margin: 0, borderRadius: 0 }}>
        <div style={{ padding: "1rem" }}>
          <p className="hint-text">
            Upload a JSON file to populate this Emitter with new sources.
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
              {isImporting ? "Importing..." : "Select JSON File"}
            </button>
            {error && <span className="error-text" style={{ fontSize: "0.8rem" }}>{error}</span>}
          </div>
        </div>
      </div>
    </Modal>
  );
}
