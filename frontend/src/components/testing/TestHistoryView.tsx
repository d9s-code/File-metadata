import { useState, type FormEvent } from "react";
import type { TestRecord, TestRecordInput } from "../../api/testRecords";
import type { TestResult, TestType } from "../../types/domain";
import { RequireRole } from "../../auth/RequireAuth";
import { ApiRequestError } from "../../api/client";

const TEST_TYPES: TestType[] = ["simulation", "lab_bench", "live_range", "field_exercise"];
const TEST_RESULTS: TestResult[] = ["pass", "fail", "partial", "inconclusive"];

export function TestHistoryView({
  records,
  onCreate,
  onDelete,
  creating,
}: {
  records: TestRecord[];
  onCreate: (input: TestRecordInput) => Promise<unknown>;
  onDelete: (id: string) => Promise<unknown>;
  creating: boolean;
}) {
  const [testType, setTestType] = useState<TestType>("simulation");
  const [result, setResult] = useState<TestResult>("pass");
  const [title, setTitle] = useState("");
  const [testDate, setTestDate] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await onCreate({ test_type: testType, result, title, test_date: testDate, notes: notes || undefined });
      setTitle("");
      setTestDate("");
      setNotes("");
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
                <td>{r.notes ?? "—"}</td>
                <td>
                  <RequireRole minimum="editor">
                    <button className="link-button" onClick={() => void onDelete(r.id)}>
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
          <input placeholder="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
          <button type="submit" disabled={creating}>
            Log Test
          </button>
          {error && <div className="error-text">{error}</div>}
        </form>
      </RequireRole>
    </div>
  );
}
