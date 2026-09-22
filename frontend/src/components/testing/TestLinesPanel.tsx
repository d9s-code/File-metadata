import { useState, type FormEvent } from "react";
import type { TestLine, TestLineCreateInput } from "../../api/testLines";
import { useDeleteTestLine, useImportTestLines } from "../../state/hooks/useTestLines";
import { ApiRequestError } from "../../api/client";
import { RequireRole } from "../../auth/RequireAuth";
import { useConfirmDialog } from "../common/ConfirmDialog";

interface ModeOption {
  id: string;
  name: string;
}

/** Parses one line of the paste box: "label" or "label | expected mode name".
 * The mode name (if given) is matched case-insensitively against this
 * Emitter's current Modes — unmatched names still import fine, just without
 * an expected_mode_id, since a Test Line predates the Mode it's about. */
function parseRows(text: string, modes: ModeOption[]): { input: TestLineCreateInput; unmatchedModeName: string | null }[] {
  const byName = new Map(modes.map((m) => [m.name.toLowerCase(), m.id]));
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [label, modeName] = line.split("|").map((s) => s.trim());
      if (!modeName) return { input: { label }, unmatchedModeName: null };
      const modeId = byName.get(modeName.toLowerCase());
      return modeId
        ? { input: { label, expected_mode_id: modeId }, unmatchedModeName: null }
        : { input: { label }, unmatchedModeName: modeName };
    });
}

/** The reference table a Test Run is checked against — imported once,
 * reused across runs. Deliberately lightweight: a label and an optional
 * cross-reference to a Mode, nothing else required up front. */
export function TestLinesPanel({
  emitterId,
  lines,
  modes,
}: {
  emitterId: string;
  lines: TestLine[];
  modes: ModeOption[];
}) {
  const [showForm, setShowForm] = useState(false);
  const [batchLabel, setBatchLabel] = useState("");
  const [pasteText, setPasteText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [unmatchedWarning, setUnmatchedWarning] = useState<string[] | null>(null);
  const importLines = useImportTestLines(emitterId);
  const deleteLine = useDeleteTestLine(emitterId);
  const { confirmDelete, dialog } = useConfirmDialog();

  async function handleImport(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setUnmatchedWarning(null);
    const parsed = parseRows(pasteText, modes);
    if (parsed.length === 0) {
      setError("Paste at least one line.");
      return;
    }
    try {
      await importLines.mutateAsync({ lines: parsed.map((p) => p.input), batch_label: batchLabel || undefined });
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Failed to import");
      return;
    }
    const unmatched = parsed.map((p) => p.unmatchedModeName).filter((n): n is string => n != null);
    if (unmatched.length > 0) setUnmatchedWarning(unmatched);
    setPasteText("");
    setBatchLabel("");
    setShowForm(false);
  }

  async function handleDelete(id: string, label: string) {
    if (await confirmDelete(`Delete test line "${label}"? Existing test results referencing it are kept.`)) {
      await deleteLine.mutateAsync(id);
    }
  }

  return (
    <div className="card">
      <h5>Test Lines</h5>
      <p className="hint-text">
        The simulated-signal reference table a Test Run is checked against — imported once, reused across runs. Each
        line is a claim about what the simulator presents ("Threat 3, high-PRF search"), not a description of this
        Emitter's own Modes.
      </p>

      {lines.length === 0 ? (
        <p className="hint-text">No Test Lines imported yet.</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Label</th>
              <th>Expected Mode</th>
              <th>Batch</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id}>
                <td>{l.label}</td>
                <td>{l.expected_mode_name ?? "—"}</td>
                <td>{l.import_batch_label ?? "—"}</td>
                <td>
                  <RequireRole minimum="editor">
                    <button className="link-button link-button-danger" onClick={() => void handleDelete(l.id, l.label)}>
                      Delete
                    </button>
                  </RequireRole>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <RequireRole minimum="editor">
        {!showForm ? (
          <button className="icon-button" onClick={() => setShowForm(true)}>
            + Import Test Lines
          </button>
        ) : (
          <form className="card" onSubmit={handleImport}>
            <label>
              Batch label (optional) — e.g. a filename or "2026-09 threat table"
              <input value={batchLabel} onChange={(e) => setBatchLabel(e.target.value)} />
            </label>
            <label>
              Paste rows — one per line: <code>label</code> or <code>label | expected mode name</code>
              <textarea
                placeholder={"Threat 3, high-PRF search\nThreat 3, low-PRF search | LPRF Search"}
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                rows={6}
              />
            </label>
            <div className="form-row">
              <button type="submit" disabled={importLines.isPending}>
                Import
              </button>
              <button type="button" className="icon-button" onClick={() => setShowForm(false)}>
                Cancel
              </button>
            </div>
            {error && <div className="error-text">{error}</div>}
          </form>
        )}
      </RequireRole>
      {unmatchedWarning && (
        <p className="hint-text">
          Imported. {unmatchedWarning.length} line(s) named a mode that wasn't found by name, so they were imported
          without an expected-mode link: {unmatchedWarning.join(", ")}.
        </p>
      )}
      {dialog}
    </div>
  );
}
