import { useRef, useState } from "react";
import { Modal } from "../common/Modal";
import { prsImportApi, type PrsImportIssue, type PrsImportResult } from "../../api/prsImport";
import { ApiRequestError } from "../../api/client";
import { useQueryClient } from "@tanstack/react-query";
import type { Source } from "../../types/domain";
import { emitterModesKey } from "../../state/hooks/useModes";
import { ewGroupsKey } from "../../state/hooks/useEwGroups";
import { sourcesKey } from "../../state/hooks/useSources";

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Imports Modes from a PRS-format Emitter XML file (the same shape this
 * app's own "Export XML" produces) — the mirror of that export. The PRS
 * format has no concept of a Source, so the user always picks or creates
 * one to attach the imported Modes to. */
export function PrsImportModal({
  emitterId,
  sources,
  onClose,
  onDone,
}: {
  emitterId: string;
  sources: Source[];
  onClose: () => void;
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [sourceId, setSourceId] = useState("");
  const [newSourceName, setNewSourceName] = useState("");
  const [sourceDate, setSourceDate] = useState(todayDate());
  const [isImporting, setIsImporting] = useState(false);
  const [genericError, setGenericError] = useState<string | null>(null);
  const [issues, setIssues] = useState<PrsImportIssue[] | null>(null);
  const [result, setResult] = useState<PrsImportResult | null>(null);

  const usingNewSource = sourceId === "";

  async function handleImport() {
    if (!file) return;
    setGenericError(null);
    setIssues(null);
    if (usingNewSource && !newSourceName.trim()) {
      setGenericError("Name the new Source, or pick an existing one.");
      return;
    }
    setIsImporting(true);
    try {
      const res = await prsImportApi.import(
        emitterId,
        file,
        usingNewSource
          ? { new_source_name: newSourceName.trim(), source_date: sourceDate || undefined }
          : { source_id: sourceId },
      );
      setResult(res);
      qc.invalidateQueries({ queryKey: emitterModesKey(emitterId) });
      qc.invalidateQueries({ queryKey: ewGroupsKey(emitterId) });
      qc.invalidateQueries({ queryKey: sourcesKey(emitterId) });
    } catch (err) {
      if (err instanceof ApiRequestError && Array.isArray(err.detail)) {
        setIssues(err.detail as PrsImportIssue[]);
      } else {
        setGenericError(err instanceof ApiRequestError ? err.message : "Failed to import");
      }
    } finally {
      setIsImporting(false);
    }
  }

  return (
    <Modal title="Import from PRS" onClose={onClose} wide>
      {result ? (
        <div className="card" style={{ margin: 0 }}>
          <p>
            Imported <strong>{result.mode_count}</strong> Mode{result.mode_count === 1 ? "" : "s"}
            {result.ew_group_count > 0 && (
              <>
                {" "}
                and created <strong>{result.ew_group_count}</strong> new EW Group
                {result.ew_group_count === 1 ? "" : "s"} ({result.created_ew_group_names.join(", ")})
              </>
            )}
            .
          </p>
          <div className="form-row">
            <button className="button" onClick={onDone}>
              Done
            </button>
          </div>
        </div>
      ) : (
        <div className="card" style={{ margin: 0 }}>
          <p className="hint-text">
            Upload an Emitter XML file in PRS format — the same shape this app's own "Export XML" produces. Only
            Modes (and the EW Groups they reference) are imported; the raw Frequency/PulseWidth/PRI values in the
            file are engineered (already-widened) values, so imported Modes get a delta of 0.
          </p>

          <label className="wide-label" style={{ display: "block", marginTop: "1rem" }}>
            Source for imported Modes
            <select value={sourceId} onChange={(e) => setSourceId(e.target.value)} disabled={isImporting}>
              <option value="">— create a new Source —</option>
              {sources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>

          {usingNewSource && (
            <div className="form-row" style={{ marginTop: "0.5rem" }}>
              <label>
                New Source name
                <input value={newSourceName} onChange={(e) => setNewSourceName(e.target.value)} disabled={isImporting} />
              </label>
              <label>
                Source date
                <input
                  type="date"
                  value={sourceDate}
                  onChange={(e) => setSourceDate(e.target.value)}
                  disabled={isImporting}
                />
              </label>
            </div>
          )}

          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginTop: "1rem" }}>
            <input
              type="file"
              ref={fileInputRef}
              accept=".xml"
              style={{ display: "none" }}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            <button className="icon-button" onClick={() => fileInputRef.current?.click()} disabled={isImporting}>
              {file ? file.name : "Select XML File"}
            </button>
            <button className="button" onClick={() => void handleImport()} disabled={isImporting || !file}>
              {isImporting ? "Importing…" : "Import"}
            </button>
          </div>

          {genericError && <div className="error-text">{genericError}</div>}
          {issues && issues.length > 0 && (
            <div className="error-text">
              <p>Nothing was imported — {issues.length} Mode(s) in the file couldn't be parsed:</p>
              <ul>
                {issues.map((i, idx) => (
                  <li key={idx}>
                    <strong>{i.mode_name}</strong>: {i.error}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
