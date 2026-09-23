import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import type { TestLine, TestLineCreateInput } from "../../api/testLines";
import { useDeleteTestLine, useImportTestLines, useUpdateTestLine } from "../../state/hooks/useTestLines";
import { useEmitter } from "../../state/hooks/useEmitters";
import { useEmitterCheckoutState } from "../../state/hooks/useEmitterCheckout";
import { ApiRequestError } from "../../api/client";
import { RequireRole } from "../../auth/RequireAuth";
import { useConfirmDialog } from "../common/ConfirmDialog";
import type { TestResult } from "../../types/domain";
import { lineOutcomeLabel, TEST_RESULTS } from "./testFormat";

const COLLAPSED_STORAGE_KEY = "simTestLinesCollapsed";

/**
 * Parses a pasted table. Tab-separated when any tab is present (a direct
 * copy from Excel/Sheets), otherwise "|". Column 1 is always the label;
 * every other column is kept as reference detail, named by the header row
 * when there is one.
 */
function parseTable(text: string, hasHeaderRow: boolean): TestLineCreateInput[] {
  const rawLines = text
    .split("\n")
    .map((l) => l.replace(/\r$/, ""))
    .filter((l) => l.trim().length > 0);
  if (rawLines.length === 0) return [];

  const delimiter = rawLines.some((l) => l.includes("\t")) ? "\t" : "|";
  let rows = rawLines.map((l) => l.split(delimiter).map((c) => c.trim()));
  let headers: string[] | null = null;
  if (hasHeaderRow) {
    headers = rows[0];
    rows = rows.slice(1);
  }

  return rows
    .filter((cols) => cols[0])
    .map((cols) => {
      const extras: Record<string, string> = {};
      cols.forEach((val, i) => {
        if (i > 0 && val) extras[headers?.[i] || `column_${i + 1}`] = val;
      });
      return { label: cols[0], expected_parameters: Object.keys(extras).length > 0 ? extras : undefined };
    });
}

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function StatusBadge({ line, emitterId }: { line: TestLine; emitterId: string }) {
  if (!line.last_test_result) return <span className="hint-text">not tested</span>;
  const badge = (
    <span className={`test-result-badge test-result-${line.last_test_result}`}>
      {lineOutcomeLabel(line.last_test_result)}
    </span>
  );
  return line.last_test_record_id ? (
    <Link to={`/emitters/${emitterId}/tests/${line.last_test_record_id}`} title="Open the run this status comes from">
      {badge}
    </Link>
  ) : (
    badge
  );
}

/** The SIM Test Lines a test run is checked against — imported once, reused
 * across runs — with each line's status from the latest run that included it. */
export function SimTestLinesPanel({ emitterId, lines }: { emitterId: string; lines: TestLine[] }) {
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [showForm, setShowForm] = useState(false);
  const [batchLabel, setBatchLabel] = useState("");
  const [createdDate, setCreatedDate] = useState("");
  const [pasteText, setPasteText] = useState("");
  const [hasHeaderRow, setHasHeaderRow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [editCreatedDate, setEditCreatedDate] = useState("");
  const importLines = useImportTestLines(emitterId);
  const updateLine = useUpdateTestLine(emitterId);
  const deleteLine = useDeleteTestLine(emitterId);
  const { confirmDelete, dialog } = useConfirmDialog();
  const { data: emitter } = useEmitter(emitterId);
  const { canEdit } = useEmitterCheckoutState(emitter);

  const statusCounts: Partial<Record<TestResult | "untested", number>> = {};
  for (const l of lines) {
    const key = l.last_test_result ?? "untested";
    statusCounts[key] = (statusCounts[key] ?? 0) + 1;
  }

  function toggleCollapsed() {
    setCollapsed((prev) => {
      try {
        localStorage.setItem(COLLAPSED_STORAGE_KEY, String(!prev));
      } catch {
        // Not persisted; still toggles for this page view.
      }
      return !prev;
    });
  }

  async function handleImport(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = parseTable(pasteText, hasHeaderRow);
    if (parsed.length === 0) {
      setError("Paste at least one row.");
      return;
    }
    try {
      await importLines.mutateAsync({ lines: parsed, batch_label: batchLabel || undefined, created_date: createdDate });
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Failed to import");
      return;
    }
    setPasteText("");
    setBatchLabel("");
    setCreatedDate("");
    setShowForm(false);
    setCollapsed(false);
  }

  function startEdit(l: TestLine) {
    setEditingId(l.id);
    setEditLabel(l.label);
    setEditCreatedDate(l.created_date ?? "");
  }

  async function handleSaveEdit(id: string) {
    setError(null);
    try {
      await updateLine.mutateAsync({
        id,
        input: { label: editLabel, created_date: editCreatedDate || undefined },
      });
      setEditingId(null);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Failed to save");
    }
  }

  async function handleDelete(id: string, label: string) {
    if (await confirmDelete(`Delete SIM Test Line "${label}"? Existing test results referencing it are kept.`)) {
      await deleteLine.mutateAsync(id);
    }
  }

  return (
    <div className="card sim-test-lines-panel">
      <div className="sim-test-lines-header">
        <button type="button" className="link-button section-toggle" onClick={toggleCollapsed} aria-expanded={!collapsed}>
          {collapsed ? "▸" : "▾"} <h5>SIM Test Lines ({lines.length})</h5>
        </button>
        {lines.length > 0 && (
          <span className="test-record-mode-summary">
            {TEST_RESULTS.filter((r) => statusCounts[r]).map((r) => (
              <span key={r} className={`test-result-badge test-result-${r}`}>
                {statusCounts[r]} {lineOutcomeLabel(r)}
              </span>
            ))}
            {statusCounts.untested && <span className="hint-text">{statusCounts.untested} not tested</span>}
          </span>
        )}
      </div>

      {!collapsed && (
        <>
          {!canEdit && <p className="hint-text">Start editing this Emitter to import, edit, or delete SIM Test Lines.</p>}

          {lines.length === 0 ? (
            <p className="hint-text">No SIM Test Lines imported yet.</p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Label</th>
                  <th>Status</th>
                  <th>Last tested</th>
                  <th>Created</th>
                  <th>Batch</th>
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
                        <StatusBadge line={l} emitterId={emitterId} />
                      </td>
                      <td>{l.last_tested_at ?? "—"}</td>
                      <td>
                        <input type="date" value={editCreatedDate} onChange={(e) => setEditCreatedDate(e.target.value)} />
                      </td>
                      <td>{l.import_batch_label ?? "—"}</td>
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
                      <td>
                        <StatusBadge line={l} emitterId={emitterId} />
                      </td>
                      <td>{l.last_tested_at ?? "—"}</td>
                      <td>{l.created_date ?? "—"}</td>
                      <td>{l.import_batch_label ?? "—"}</td>
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
                + Import SIM Test Lines
              </button>
            ) : (
              <form className="card" onSubmit={handleImport}>
                <div className="form-row">
                  <label>
                    Date the SIM lines were created (required)
                    <input type="date" value={createdDate} onChange={(e) => setCreatedDate(e.target.value)} required />
                  </label>
                  <label>
                    Batch label (optional) — e.g. a filename or "2026-09 threat table"
                    <input value={batchLabel} onChange={(e) => setBatchLabel(e.target.value)} />
                  </label>
                </div>
                <label className="checkbox-label">
                  <input type="checkbox" checked={hasHeaderRow} onChange={(e) => setHasHeaderRow(e.target.checked)} />
                  First row is a header (names the other columns — column 1 is always the label either way)
                </label>
                <label>
                  Paste rows — select cells in Excel/Sheets and paste directly (tab-separated), or type one label per
                  line. Column 1 of each row is the label; any other columns are kept as reference detail.
                  <textarea
                    placeholder={"Threat 3, high-PRF search\nThreat 3, low-PRF search"}
                    value={pasteText}
                    onChange={(e) => setPasteText(e.target.value)}
                    rows={6}
                  />
                </label>
                <div className="form-row">
                  <button type="submit" disabled={importLines.isPending || !canEdit || !createdDate}>
                    Import
                  </button>
                  <button type="button" className="icon-button" onClick={() => setShowForm(false)}>
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </RequireRole>
          {error && <div className="error-text">{error}</div>}
        </>
      )}
      {dialog}
    </div>
  );
}
