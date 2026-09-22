import { useState, type FormEvent } from "react";
import type { TestLine, TestLineCreateInput } from "../../api/testLines";
import { useDeleteTestLine, useImportTestLines, useUpdateTestLine } from "../../state/hooks/useTestLines";
import { useEmitter } from "../../state/hooks/useEmitters";
import { useEmitterCheckoutState } from "../../state/hooks/useEmitterCheckout";
import { ApiRequestError } from "../../api/client";
import { RequireRole } from "../../auth/RequireAuth";
import { useConfirmDialog } from "../common/ConfirmDialog";

interface ModeOption {
  id: string;
  name: string;
}

interface ParsedRow {
  input: TestLineCreateInput;
  unmatchedModeName: string | null;
}

/**
 * Parses a pasted table. Auto-detects the delimiter: tab when present (a
 * direct copy-paste from Excel/Sheets), otherwise "|" (quick manual typing).
 * Column 1 of every data row is always the label — that's positional, never
 * inferred from a header's wording. `hasHeaderRow` (an explicit checkbox,
 * not guessed from the text) says whether row 1 is itself data or a row of
 * column names for columns 2+; without one, two columns is the classic
 * shorthand "label | expected mode name", but three or more is treated as
 * an unlabeled table — we don't guess which column might be a Mode name, so
 * every column past the first becomes extra reference detail instead.
 */
function parseTable(text: string, modes: ModeOption[], hasHeaderRow: boolean): ParsedRow[] {
  const byName = new Map(modes.map((m) => [m.name.toLowerCase(), m.id]));
  const rawLines = text
    .split("\n")
    .map((l) => l.replace(/\r$/, ""))
    .filter((l) => l.trim().length > 0);
  if (rawLines.length === 0) return [];

  const delimiter = rawLines.some((l) => l.includes("\t")) ? "\t" : "|";
  let rows = rawLines.map((l) => l.split(delimiter).map((c) => c.trim()));

  let headers: string[] | null = null;
  if (hasHeaderRow && rows.length > 0) {
    headers = rows[0];
    rows = rows.slice(1);
  }

  const modeColIndex = headers
    ? headers.findIndex((h, i) => i > 0 && h.toLowerCase().includes("mode"))
    : rows.every((r) => r.length <= 2)
      ? 1
      : -1;

  return rows
    .filter((cols) => cols[0])
    .map((cols) => {
      const label = cols[0];
      const extras: Record<string, string> = {};
      cols.forEach((val, i) => {
        if (i === 0 || i === modeColIndex || !val) return;
        extras[headers?.[i] || `column_${i + 1}`] = val;
      });
      const expected_parameters = Object.keys(extras).length > 0 ? extras : undefined;
      const modeName = modeColIndex >= 0 ? cols[modeColIndex] : undefined;
      if (!modeName) return { input: { label, expected_parameters }, unmatchedModeName: null };
      const modeId = byName.get(modeName.toLowerCase());
      return modeId
        ? { input: { label, expected_mode_id: modeId, expected_parameters }, unmatchedModeName: null }
        : { input: { label, expected_parameters }, unmatchedModeName: modeName };
    });
}

function formatEditedAt(iso: string): string {
  return new Date(iso).toLocaleString();
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
  const [hasHeaderRow, setHasHeaderRow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unmatchedWarning, setUnmatchedWarning] = useState<string[] | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [editModeId, setEditModeId] = useState("");
  const importLines = useImportTestLines(emitterId);
  const updateLine = useUpdateTestLine(emitterId);
  const deleteLine = useDeleteTestLine(emitterId);
  const { confirmDelete, dialog } = useConfirmDialog();
  const { data: emitter } = useEmitter(emitterId);
  const { canEdit } = useEmitterCheckoutState(emitter);

  async function handleImport(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setUnmatchedWarning(null);
    const parsed = parseTable(pasteText, modes, hasHeaderRow);
    if (parsed.length === 0) {
      setError("Paste at least one row.");
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

  function startEdit(l: TestLine) {
    setEditingId(l.id);
    setEditLabel(l.label);
    setEditModeId(l.expected_mode_id ?? "");
  }

  async function handleSaveEdit(id: string) {
    setError(null);
    try {
      await updateLine.mutateAsync({ id, input: { label: editLabel, expected_mode_id: editModeId || null } });
      setEditingId(null);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Failed to save");
    }
  }

  async function handleDelete(id: string, label: string) {
    if (await confirmDelete(`Delete test line "${label}"? Existing test results referencing it are kept.`)) {
      await deleteLine.mutateAsync(id);
    }
  }

  return (
    <div className="card">
      <h5>Test Lines</h5>
      {!canEdit && <p className="hint-text">Start editing this Emitter to import, edit, or delete Test Lines.</p>}

      {lines.length === 0 ? (
        <p className="hint-text">No Test Lines imported yet.</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Label</th>
              <th>Expected Mode</th>
              <th>Batch</th>
              <th>Last edited</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) =>
              editingId === l.id ? (
                <tr key={l.id}>
                  <td>
                    <input value={editLabel} onChange={(e) => setEditLabel(e.target.value)} />
                  </td>
                  <td>
                    <select value={editModeId} onChange={(e) => setEditModeId(e.target.value)}>
                      <option value="">—</option>
                      {modes.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>{l.import_batch_label ?? "—"}</td>
                  <td>{formatEditedAt(l.updated_at)}</td>
                  <td>
                    <button
                      className="link-button"
                      disabled={updateLine.isPending || !editLabel.trim()}
                      onClick={() => void handleSaveEdit(l.id)}
                    >
                      Save
                    </button>{" "}
                    <button className="link-button" onClick={() => setEditingId(null)}>
                      Cancel
                    </button>
                  </td>
                </tr>
              ) : (
                <tr key={l.id}>
                  <td>{l.label}</td>
                  <td>{l.expected_mode_name ?? "—"}</td>
                  <td>{l.import_batch_label ?? "—"}</td>
                  <td>{formatEditedAt(l.updated_at)}</td>
                  <td>
                    <RequireRole minimum="editor">
                      <button className="link-button" disabled={!canEdit} onClick={() => startEdit(l)}>
                        Edit
                      </button>{" "}
                      <button
                        className="link-button link-button-danger"
                        disabled={!canEdit}
                        onClick={() => void handleDelete(l.id, l.label)}
                      >
                        Delete
                      </button>
                    </RequireRole>
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      )}

      <RequireRole minimum="editor">
        {!showForm ? (
          <button className="icon-button" disabled={!canEdit} onClick={() => setShowForm(true)}>
            + Import Test Lines
          </button>
        ) : (
          <form className="card" onSubmit={handleImport}>
            <label>
              Batch label (optional) — e.g. a filename or "2026-09 threat table"
              <input value={batchLabel} onChange={(e) => setBatchLabel(e.target.value)} />
            </label>
            <label className="checkbox-label">
              <input type="checkbox" checked={hasHeaderRow} onChange={(e) => setHasHeaderRow(e.target.checked)} />
              First row is a header (names the other columns — column 1 is always the label either way)
            </label>
            <label>
              Paste rows — select cells in Excel/Sheets and paste directly (tab-separated), or type{" "}
              <code>label | expected mode name</code> one per line. Column 1 of each row is always the label; if a
              column is named something with "mode" in it, that column links to an existing Mode by name.
              <textarea
                placeholder={"Threat 3, high-PRF search\nThreat 3, low-PRF search | LPRF Search"}
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                rows={6}
              />
            </label>
            <div className="form-row">
              <button type="submit" disabled={importLines.isPending || !canEdit}>
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
