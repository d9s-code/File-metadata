import { useState, type FormEvent } from "react";
import { formatDate } from "../common/dates";
import { DateInput } from "../common/DateInput";
import { DwellInput, MANUAL_DWELL } from "./DwellInput";
import { ReceivedPowerInput, receivedPowerError } from "./ReceivedPowerInput";
import { useCreateMdfTestRecord, useDeleteMdfTestRecord, useMdfTestRecords } from "../../state/hooks/useTestRecords";
import { LOGGABLE_TEST_TYPES, type LoggableTestType, type TestResult } from "../../types/domain";
import { ApiRequestError } from "../../api/client";
import { RequireRole } from "../../auth/RequireAuth";
import { TestRecordsTable } from "./TestRecordsTable";
import { TEST_RESULTS, testResultLabel, testTypeLabel } from "./testFormat";
import { MdfScenarioSection, MdfScenarioView, scenarioError, scenarioInput, scenarioResult, useMdfScenarioOptions, type PresentedDraft } from "./MdfScenario";

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

/** MDF-scoped tests have no SIM Test Lines or Modes of their own: a run is
 * its overall result — and, optionally, what was observed: the Platforms
 * presented, the Emitters on the air, what each was reported as. */
export function MdfTestHistory({ mdfId, highlightTestRecordId }: { mdfId: string; highlightTestRecordId?: string }) {
  const { data: records } = useMdfTestRecords(mdfId);
  const create = useCreateMdfTestRecord(mdfId);
  const del = useDeleteMdfTestRecord(mdfId);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [testType, setTestType] = useState<LoggableTestType>("simulation");
  const [testDate, setTestDate] = useState(todayDate());
  const [simCreatedDate, setSimCreatedDate] = useState("");
  const [dwell, setDwell] = useState(MANUAL_DWELL);
  const [receivedPower, setReceivedPower] = useState("");
  /** "" — worked out from what was observed. */
  const [result, setResult] = useState<TestResult | "">("pass");
  const [presented, setPresented] = useState<PresentedDraft[]>([]);
  const { data: options, error: optionsError } = useMdfScenarioOptions(mdfId, showForm);
  const worked = scenarioResult(presented);
  const [retestsId, setRetestsId] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const powerProblem = receivedPowerError(receivedPower);
    if (powerProblem) {
      setError(powerProblem);
      return;
    }
    const scenarioProblem = scenarioError(presented);
    if (scenarioProblem) {
      setError(scenarioProblem);
      return;
    }
    if (!result && !presented.length) {
      setError("Pick a result, or present a Platform to work it out from");
      return;
    }
    try {
      await create.mutateAsync({
        test_type: testType,
        title,
        test_date: testDate,
        simulation_created_date: simCreatedDate || undefined,
        received_power_dbfs: Number(receivedPower),
        dwell: dwell.trim() || undefined,
        result: result || undefined,
        mdf_scenario: scenarioInput(presented),
        notes: notes.trim() || undefined,
        retests_test_record_id: retestsId || undefined,
      });
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Failed to log test");
      return;
    }
    setTitle("");
    setNotes("");
    setReceivedPower("");
    setRetestsId("");
    setPresented([]);
    setResult("pass");
    setShowForm(false);
  }

  function changePresented(next: PresentedDraft[]) {
    // Presenting the first Platform: let the result be worked out from it.
    if (!presented.length && next.length && result === "pass") setResult("");
    if (presented.length && !next.length && result === "") setResult("pass");
    setPresented(next);
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
        renderDetail={(r) => ((r.mdf_test_platforms ?? []).length ? <MdfScenarioView record={r} /> : null)}
      />
      <RequireRole minimum="editor">
        {!showForm ? (
          <button className="icon-button" onClick={() => setShowForm(true)}>
            + Add test run
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
                <DateInput value={testDate} onChange={(e) => setTestDate(e.target.value)} required />
              </label>
              <label className="inline-date-label">
                {testType === "simulation" ? "Simulation created" : "Intercept date (optional)"}
                <DateInput
                  value={simCreatedDate}
                  onChange={(e) => setSimCreatedDate(e.target.value)}
                  required={testType === "simulation"}
                />
              </label>
              <DwellInput value={dwell} onChange={setDwell} />
              <ReceivedPowerInput value={receivedPower} onChange={setReceivedPower} />
              <label className="inline-date-label">
                Result
                <select
                  value={result}
                  className={result || worked ? `outcome-select test-result-${result || worked}` : undefined}
                  onChange={(e) => setResult(e.target.value as TestResult | "")}
                >
                  {presented.length > 0 && <option value="">Worked out: {worked ? testResultLabel(worked) : "—"}</option>}
                  {TEST_RESULTS.map((r) => (
                    <option key={r} value={r}>
                      {testResultLabel(r)}
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
                      {r.title} — {formatDate(r.test_date)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {options ? (
              <MdfScenarioSection mdfId={mdfId} options={options} value={presented} onChange={changePresented} />
            ) : optionsError ? (
              <p className="hint-text">Save a version of this MDF to record which Platforms were presented and what was heard.</p>
            ) : null}
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
