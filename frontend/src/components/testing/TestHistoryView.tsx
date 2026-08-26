import { useEffect, useState, type FormEvent } from "react";
import type { TestRecord, TestRecordInput } from "../../api/testRecords";
import type { TestResult, TestType } from "../../types/domain";
import { RequireRole } from "../../auth/RequireAuth";
import { ApiRequestError } from "../../api/client";
import { useConfirmDialog } from "../common/ConfirmDialog";

const TEST_TYPES: TestType[] = ["simulation", "lab_bench", "live_range", "field_exercise"];
const TEST_RESULTS: TestResult[] = ["pass", "fail", "partial", "inconclusive"];

export function TestHistoryView({
  records,
  onCreate,
  onDelete,
  creating,
  availableModes,
}: {
  records: TestRecord[];
  onCreate: (input: TestRecordInput) => Promise<unknown>;
  onDelete: (id: string) => Promise<unknown>;
  creating: boolean;
  /** Modes the "log test" form can link this record to. Omitted where there's no
   * direct Emitter scope to draw a Mode list from (e.g. MDF-scoped tests). */
  availableModes?: { id: string; name: string }[];
}) {
  const [testType, setTestType] = useState<TestType>("simulation");
  const [result, setResult] = useState<TestResult>("pass");
  const [title, setTitle] = useState("");
  const [testDate, setTestDate] = useState("");
  const [notes, setNotes] = useState("");
  const [modeIds, setModeIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const { confirmDelete, dialog } = useConfirmDialog();

  // A test run is assumed to exercise every current Mode unless told
  // otherwise — with 70+ Modes on some Emitters, requiring an editor to
  // individually check each one would make logging a test painful. Default
  // to "all selected" and let them uncheck the few that weren't covered.
  useEffect(() => {
    setModeIds((availableModes ?? []).map((m) => m.id));
  }, [availableModes]);

  function toggleMode(id: string) {
    setModeIds((ids) => (ids.includes(id) ? ids.filter((i) => i !== id) : [...ids, id]));
  }

  async function handleDelete(id: string, title: string) {
    if (await confirmDelete(`Delete the test record "${title}"?`)) {
      await onDelete(id);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await onCreate({
        test_type: testType,
        result,
        title,
        test_date: testDate,
        notes: notes || undefined,
        mode_ids: modeIds,
      });
      setTitle("");
      setTestDate("");
      setNotes("");
      setModeIds((availableModes ?? []).map((m) => m.id));
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Failed to log test");
    }
  }

  return (
    <div>
      {records.length === 0 ? (
        <p className="hint-text">No tests logged yet.</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Type</th>
              <th>Result</th>
              <th>Title</th>
              <th>Modes</th>
              <th>Notes</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {records.map((r) => (
              <tr key={r.id}>
                <td>{r.test_date}</td>
                <td>{r.test_type.replace("_", " ")}</td>
                <td>
                  <span className={`test-result-badge test-result-${r.result}`}>{r.result}</span>
                </td>
                <td>{r.title}</td>
                <td>{r.modes?.length ? r.modes.map((m) => m.mode_name).join(", ") : "—"}</td>
                <td>{r.notes ?? "—"}</td>
                <td>
                  <RequireRole minimum="editor">
                    <button className="link-button" onClick={() => void handleDelete(r.id, r.title)}>
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
        <form className="card inline-form" onSubmit={handleSubmit}>
          <select value={testType} onChange={(e) => setTestType(e.target.value as TestType)}>
            {TEST_TYPES.map((t) => (
              <option key={t} value={t}>
                {t.replace("_", " ")}
              </option>
            ))}
          </select>
          <select value={result} onChange={(e) => setResult(e.target.value as TestResult)}>
            {TEST_RESULTS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <input placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} required />
          <input type="date" value={testDate} onChange={(e) => setTestDate(e.target.value)} required />
          <label className="test-notes-field">
            Notes (optional)
            <textarea
              placeholder="Any context worth recording about this test run…"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={4}
            />
          </label>
          {availableModes && availableModes.length > 0 && (
            <fieldset className="mode-link-picker">
              <legend>
                Modes exercised — assumed to be all of them ({modeIds.length}/{availableModes.length});
                uncheck any that weren't{" "}
                <button type="button" className="link-button" onClick={() => setModeIds(availableModes.map((m) => m.id))}>
                  select all
                </button>{" "}
                ·{" "}
                <button type="button" className="link-button" onClick={() => setModeIds([])}>
                  select none
                </button>
              </legend>
              {availableModes.map((m) => (
                <label key={m.id} className="mode-link-option">
                  <input type="checkbox" checked={modeIds.includes(m.id)} onChange={() => toggleMode(m.id)} />
                  {m.name}
                </label>
              ))}
            </fieldset>
          )}
          <button type="submit" disabled={creating}>
            Log Test
          </button>
          {error && <div className="error-text">{error}</div>}
        </form>
      </RequireRole>
      {dialog}
    </div>
  );
}
