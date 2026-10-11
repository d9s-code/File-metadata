import { useState, type FormEvent } from "react";
import { formatDate } from "../common/dates";
import { DateInput } from "../common/DateInput";
import { Link } from "react-router-dom";
import type { TestLine, TestLineCreateInput, TestLineSyncResult } from "../../api/testLines";
import {
  useDeleteTestLine,
  useImportTestLines,
  useSyncTestLines,
  useUpdateTestLine,
} from "../../state/hooks/useTestLines";
import { useEmitterModes } from "../../state/hooks/useModes";
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

/** A line's reference detail as "name: value" text, one per line. */
function detailText(detail: Record<string, unknown> | null): string {
  return Object.entries(detail ?? {})
    .map(([k, v]) => `${k}: ${String(v)}`)
    .join("\n");
}

function parseDetail(text: string): Record<string, string> | null {
  const out: Record<string, string> = {};
  text.split("\n").forEach((row, i) => {
    const t = row.trim();
    if (!t) return;
    const at = t.indexOf(":");
    if (at > 0) out[t.slice(0, at).trim()] = t.slice(at + 1).trim();
    else out[`column_${i + 2}`] = t;
  });
  return Object.keys(out).length ? out : null;
}

function detailSummary(detail: Record<string, unknown> | null): string {
  return Object.entries(detail ?? {})
    .map(([k, v]) => `${k}: ${String(v)}`)
    .join(" · ");
}

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function StatusBadge({ line, emitterId }: { line: TestLine; emitterId: string }) {
  if (!line.last_test_result) return <span className="hint-text">Not tested</span>;
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
  // Which table form is open: a new import, or a revised table to update the lines from.
  const [formMode, setFormMode] = useState<"import" | "update" | null>(null);
  const [removeMissing, setRemoveMissing] = useState(false);
  const [preview, setPreview] = useState<TestLineSyncResult | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [batchLabel, setBatchLabel] = useState("");
  const [createdDate, setCreatedDate] = useState("");
  const [pasteText, setPasteText] = useState("");
  const [hasHeaderRow, setHasHeaderRow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [editCreatedDate, setEditCreatedDate] = useState("");
  const [editModeId, setEditModeId] = useState("");
  const [editDetail, setEditDetail] = useState("");
  const importLines = useImportTestLines(emitterId);
  const updateLine = useUpdateTestLine(emitterId);
  const syncLines = useSyncTestLines(emitterId);
  const { data: modes } = useEmitterModes(emitterId);
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
    closeForm();
    setCollapsed(false);
  }

  function closeForm() {
    setPasteText("");
    setBatchLabel("");
    setCreatedDate("");
    setRemoveMissing(false);
    setPreview(null);
    setFormMode(null);
  }

  /** Revised table: preview what it changes first, then apply. */
  async function handleUpdate(e: FormEvent, apply: boolean) {
    e.preventDefault();
    setError(null);
    const parsed = parseTable(pasteText, hasHeaderRow);
    if (parsed.length === 0) {
      setError("Paste at least one row.");
      return;
    }
    try {
      const result = await syncLines.mutateAsync({
        lines: parsed,
        created_date: createdDate,
        batch_label: batchLabel || undefined,
        remove_missing: removeMissing,
        apply,
      });
      if (!apply) {
        setPreview(result);
        return;
      }
      setNotice(
        `Updated from the table: ${result.added.length} added, ${result.updated.length} updated, ${result.unchanged.length} unchanged` +
          (result.missing.length ? `, ${result.missing.length} ${result.removed ? "removed" : "kept (not in the table)"}` : "") +
          ".",
      );
      closeForm();
      setCollapsed(false);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Failed to update");
    }
  }

  function startEdit(l: TestLine) {
    setEditingId(l.id);
    setEditLabel(l.label);
    setEditCreatedDate(l.created_date ?? "");
    setEditModeId(l.expected_mode_id ?? "");
    setEditDetail(detailText(l.expected_parameters));
  }

  async function handleSaveEdit(id: string) {
    setError(null);
    try {
      await updateLine.mutateAsync({
        id,
        input: {
          label: editLabel,
          created_date: editCreatedDate || undefined,
          expected_mode_id: editModeId || null,
          expected_parameters: parseDetail(editDetail),
        },
      });
      setEditingId(null);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Failed to save");
    }
  }

  async function handleDelete(id: string, label: string) {
    if (
      await confirmDelete(
        `Delete SIM Test Line "${label}"? Its results in logged test runs are deleted with it. To change the line instead, use Edit.`,
      )
    ) {
      await deleteLine.mutateAsync(id);
    }
  }

  return (
    <div className="card sim-test-lines-panel">
      <div className="sim-test-lines-header">
        <button type="button" className="link-button section-toggle" onClick={toggleCollapsed} aria-expanded={!collapsed}>
          {collapsed ? "▸" : "▾"} <h4>SIM Test Lines</h4>{" "}
          <span className="hint-text section-count">{lines.length}</span>
        </button>
        {lines.length > 0 && (
          <span className="test-record-mode-summary">
            {TEST_RESULTS.filter((r) => statusCounts[r]).map((r) => (
              <span key={r} className={`test-result-badge test-result-${r}`}>
                {statusCounts[r]} {lineOutcomeLabel(r)}
              </span>
            ))}
            {statusCounts.untested && <span className="hint-text">{statusCounts.untested} Not tested</span>}
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
                  <th>Expected Mode</th>
                  <th>Detail</th>
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
                        <input value={editLabel} onChange={(e) => setEditLabel(e.target.value)} aria-label="Label" />
                      </td>
                      <td>
                        <select value={editModeId} onChange={(e) => setEditModeId(e.target.value)} aria-label="Expected Mode">
                          <option value="">—</option>
                          {(modes ?? []).map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <textarea
                          value={editDetail}
                          onChange={(e) => setEditDetail(e.target.value)}
                          rows={Math.max(2, editDetail.split("\n").length)}
                          placeholder={"RF: 9000\nPRI: 1000"}
                          aria-label="Detail, one name: value per line"
                        />
                      </td>
                      <td>
                        <StatusBadge line={l} emitterId={emitterId} />
                      </td>
                      <td>{formatDate(l.last_tested_at)}</td>
                      <td>
                        <DateInput value={editCreatedDate} onChange={(e) => setEditCreatedDate(e.target.value)} />
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
                      <td>{l.expected_mode_name ?? "—"}</td>
                      <td className="sim-line-detail" title={detailText(l.expected_parameters) || undefined}>
                        {detailSummary(l.expected_parameters) || "—"}
                      </td>
                      <td>
                        <StatusBadge line={l} emitterId={emitterId} />
                      </td>
                      <td>{formatDate(l.last_tested_at)}</td>
                      <td>{formatDate(l.created_date)}</td>
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
            {formMode === null ? (
              <div className="form-row">
                <button className="icon-button" disabled={!canEdit} onClick={() => setFormMode("import")}>
                  + Import SIM Test Lines
                </button>
                {lines.length > 0 && (
                  <button
                    className="icon-button"
                    disabled={!canEdit}
                    onClick={() => setFormMode("update")}
                    title="Paste a revised SIM table: lines are matched by label and keep their test history"
                  >
                    ⟳ Update from a revised table
                  </button>
                )}
              </div>
            ) : (
              <form
                className="card"
                onSubmit={(e) => (formMode === "import" ? void handleImport(e) : void handleUpdate(e, !!preview))}
              >
                {formMode === "update" && (
                  <p className="hint-text">
                    Each row is matched to a line already here by its label (ignoring case and extra spaces). A matched
                    line keeps its test history and takes the row&apos;s detail (unless the row has only a label), the
                    date below and the batch label. Rows with no match are added. The lines follow the table&apos;s order.
                  </p>
                )}
                <div className="form-row">
                  <label>
                    Date the SIM lines were created (required)
                    <DateInput
                      value={createdDate}
                      onChange={(e) => {
                        setCreatedDate(e.target.value);
                        setPreview(null);
                      }}
                      required
                    />
                  </label>
                  <label>
                    Batch label (optional) — e.g. a filename or "2026-09 threat table"
                    <input
                      value={batchLabel}
                      onChange={(e) => {
                        setBatchLabel(e.target.value);
                        setPreview(null);
                      }}
                    />
                  </label>
                </div>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={hasHeaderRow}
                    onChange={(e) => {
                      setHasHeaderRow(e.target.checked);
                      setPreview(null);
                    }}
                  />
                  First row is a header (names the other columns — column 1 is always the label either way)
                </label>
                <label>
                  Paste rows — select cells in Excel/Sheets and paste directly (tab-separated), or type one label per
                  line. Column 1 of each row is the label; any other columns are kept as reference detail.
                  <textarea
                    placeholder={"Threat 3, high-PRF search\nThreat 3, low-PRF search"}
                    value={pasteText}
                    onChange={(e) => {
                      setPasteText(e.target.value);
                      setPreview(null);
                    }}
                    rows={6}
                  />
                </label>
                {formMode === "update" && (
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={removeMissing}
                      onChange={(e) => {
                        setRemoveMissing(e.target.checked);
                        setPreview(null);
                      }}
                    />
                    Delete the lines that aren&apos;t in the table — with their results in logged runs (otherwise
                    they&apos;re kept as they are)
                  </label>
                )}
                {preview && <SyncPreview result={preview} removeMissing={removeMissing} />}
                <div className="form-row">
                  {formMode === "import" ? (
                    <button type="submit" disabled={importLines.isPending || !canEdit || !createdDate}>
                      Import
                    </button>
                  ) : (
                    <button type="submit" disabled={syncLines.isPending || !canEdit || !createdDate}>
                      {syncLines.isPending ? "Working…" : preview ? "Apply these changes" : "Preview changes"}
                    </button>
                  )}
                  <button type="button" className="icon-button" onClick={closeForm}>
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </RequireRole>
          {notice && <p className="hint-text">{notice}</p>}
          {error && <div className="error-text">{error}</div>}
        </>
      )}
      {dialog}
    </div>
  );
}

/** What a revised table would do to the lines, before it's applied. */
function SyncPreview({ result, removeMissing }: { result: TestLineSyncResult; removeMissing: boolean }) {
  const lost = result.missing.reduce((n, m) => n + m.results, 0);
  return (
    <div className="sim-sync-preview">
      <strong>What this table changes</strong>
      <ul>
        <li>
          {result.added.length} new line{result.added.length === 1 ? "" : "s"}
          {result.added.length > 0 && <span className="hint-text"> — {result.added.join(", ")}</span>}
        </li>
        <li>
          {result.updated.length} updated
          {result.updated.length > 0 && (
            <ul>
              {result.updated.map((u) => (
                <li key={u.id}>
                  {u.label} <span className="hint-text">— {u.changes.join(", ")}</span>
                </li>
              ))}
            </ul>
          )}
        </li>
        <li>{result.unchanged.length} unchanged</li>
        {result.missing.length > 0 && (
          <li className={removeMissing ? "error-text" : undefined}>
            {result.missing.length} not in the table — {removeMissing ? "deleted" : "kept as they are"}:{" "}
            {result.missing.map((m) => m.label).join(", ")}
            {removeMissing && lost > 0 && ` (with their results in ${lost} logged run line${lost === 1 ? "" : "s"})`}
          </li>
        )}
      </ul>
    </div>
  );
}
