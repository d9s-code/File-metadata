import { useState, type FormEvent } from "react";
import { useCreateMdfTestRecord, useDeleteMdfTestRecord, useMdfTestRecords } from "../../state/hooks/useTestRecords";
import { LOGGABLE_TEST_TYPES, type LoggableTestType, type TestResult } from "../../types/domain";
import { ApiRequestError } from "../../api/client";
import { RequireRole } from "../../auth/RequireAuth";
import { TestRecordsTable } from "./TestRecordsTable";
import { TEST_RESULTS, testTypeLabel } from "./testFormat";

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

/** MDF-scoped tests have no SIM Test Lines or Modes of their own, so a run
 * is just its overall result. */
export function MdfTestHistory({ mdfId, highlightTestRecordId }: { mdfId: string; highlightTestRecordId?: string }) {
  const { data: records } = useMdfTestRecords(mdfId);
  const create = useCreateMdfTestRecord(mdfId);
  const del = useDeleteMdfTestRecord(mdfId);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [testType, setTestType] = useState<LoggableTestType>("simulation");
  const [testDate, setTestDate] = useState(todayDate());
  const [simCreatedDate, setSimCreatedDate] = useState("");
  const [result, setResult] = useState<TestResult>("pass");
  const [retestsId, setRetestsId] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await create.mutateAsync({
        test_type: testType,
        title,
        test_date: testDate,
        simulation_created_date: simCreatedDate || undefined,
        result,
        notes: notes.trim() || undefined,
        retests_test_record_id: retestsId || undefined,
      });
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Failed to log test");
      return;
    }
    setTitle("");
    setNotes("");
    setRetestsId("");
    setShowForm(false);
  }

  function handleRedo(id: string, retestTitle: string) {
    setShowForm(true);
    setRetestsId(id);
    setTitle(`Retest: ${retestTitle}`);
  }

  return (
    <div>
      <TestRecordsTable
        records={records ?? []}
        onDelete={(id) => del.mutateAsync(id)}
        onRedo={(r) => handleRedo(r.id, r.title)}
        highlightId={highlightTestRecordId}
      />
      <RequireRole minimum="editor">
        {!showForm ? (
          <button className="icon-button" onClick={() => setShowForm(true)}>
            + New Test
          </button>
        ) : (
          <form className="card" onSubmit={handleSubmit}>
            <div className="form-row">
              <input placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} required />
              <label className="inline-date-label">
                Type
                <select value={testType} onChange={(e) => setTestType(e.target.value as LoggableTestType)}>
                  {LOGGABLE_TEST_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {testTypeLabel(t)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="inline-date-label">
                Test date
                <input type="date" value={testDate} onChange={(e) => setTestDate(e.target.value)} required />
              </label>
              <label className="inline-date-label">
                {testType === "simulation" ? "Simulation created" : "Intercept date (optional)"}
                <input
                  type="date"
                  value={simCreatedDate}
                  onChange={(e) => setSimCreatedDate(e.target.value)}
                  required={testType === "simulation"}
                />
              </label>
              <label className="inline-date-label">
                Result
                <select value={result} onChange={(e) => setResult(e.target.value as TestResult)}>
                  {TEST_RESULTS.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="form-row">
              <label className="inline-date-label">
                Retest of (optional)
                <select value={retestsId} onChange={(e) => setRetestsId(e.target.value)}>
                  <option value="">—</option>
                  {(records ?? []).map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.title} — {r.test_date}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="test-notes-field">
              Notes (optional)
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
            </label>
            <div className="form-row">
              <button type="submit" disabled={create.isPending}>
                Log Test
              </button>
              <button type="button" className="icon-button" onClick={() => setShowForm(false)}>
                Cancel
              </button>
            </div>
            {error && <div className="error-text">{error}</div>}
          </form>
        )}
      </RequireRole>
    </div>
  );
}
