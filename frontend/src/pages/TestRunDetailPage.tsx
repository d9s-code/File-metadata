import { useState } from "react";
import { ObservedValuesTable } from "../components/testing/ObservedValuesTable";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { useEmitter } from "../state/hooks/useEmitters";
import { useEmitterCheckoutState } from "../state/hooks/useEmitterCheckout";
import { useEwGroups } from "../state/hooks/useEwGroups";
import { useSources } from "../state/hooks/useSources";
import { useChangeTestResult, useDeleteEmitterTestRecord, useEmitterTestRecords } from "../state/hooks/useTestRecords";
import { RequireRole } from "../auth/RequireAuth";
import { LoadingState } from "../components/common/LoadingState";
import { useConfirmDialog } from "../components/common/ConfirmDialog";
import { ModeForm } from "../components/modes/ModeForm";
import { useEmitterVersions } from "../state/hooks/useEmitterVersions";
import type { TestRecord } from "../api/testRecords";
import type { TestResult } from "../types/domain";
import {
  lineOutcomeLabel,
  TEST_RESULTS,
  observedValueOptions,
  testTypeLabel,
} from "../components/testing/testFormat";


function countOf<T>(items: T[], key: (item: T) => TestResult | null): [TestResult, number][] {
  return TEST_RESULTS.map((r) => [r, items.filter((i) => key(i) === r).length] as [TestResult, number]).filter(([, n]) => n > 0);
}

/** One line under the title: how the run came out, counted, and which
 * saved version of the Emitter it tested. */
function RunSummary({
  record,
  exercised,
  emitterId,
  versionNumber,
}: {
  record: TestRecord;
  exercised: TestRecord["modes"];
  emitterId: string;
  versionNumber: number | null;
}) {
  const lineCounts = countOf(record.lines, (l) => l.outcome);
  const modeCounts = countOf(exercised, (m) => m.result);
  return (
    <p className="run-summary">
      {lineCounts.length > 0 && (
        <span>
          <strong>{record.lines.length}</strong> SIM Test Line{record.lines.length === 1 ? "" : "s"}:{" "}
          {lineCounts.map(([r, n]) => (
            <span key={r} className={`test-result-badge test-result-${r}`}>
              {n} {lineOutcomeLabel(r)}
            </span>
          ))}
        </span>
      )}
      {modeCounts.length > 0 && (
        <span>
          <strong>{exercised.length}</strong> Mode{exercised.length === 1 ? "" : "s"}:{" "}
          {modeCounts.map(([r, n]) => (
            <span key={r} className={`test-result-badge test-result-${r}`}>
              {n} {r}
            </span>
          ))}
        </span>
      )}
      <span className="hint-text">
        {versionNumber != null ? (
          <>
            tested against <Link to={`/emitters/${emitterId}/versions?version=${versionNumber}`}>version {versionNumber}</Link>
          </>
        ) : (
          "tested before the Emitter had a saved version"
        )}
      </span>
    </p>
  );
}

export function TestRunDetailPage() {
  const { emitterId = "", testRecordId = "" } = useParams<{ emitterId: string; testRecordId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const stagedModeFailures = (location.state as { stagedModeFailures?: string[] } | null)?.stagedModeFailures;
  const { data: emitter } = useEmitter(emitterId);
  const { canEdit } = useEmitterCheckoutState(emitter);
  const { data: records, isLoading } = useEmitterTestRecords(emitterId);
  const { data: ewGroups } = useEwGroups(emitterId);
  const { data: sources } = useSources(emitterId);
  const del = useDeleteEmitterTestRecord(emitterId);
  const { data: versions } = useEmitterVersions(emitterId);
  const { confirmDelete, dialog } = useConfirmDialog();
  const [addingMode, setAddingMode] = useState(false);

  if (!emitter || isLoading || !records) return <LoadingState label="Loading test run…" />;
  const record = records.find((r) => r.id === testRecordId);
  const backLink = <Link to={`/emitters/${emitterId}?tab=tests`}>← Back to {emitter.name} test history</Link>;
  if (!record) {
    return (
      <div className="page">
        {backLink}
        <p className="hint-text">This test run doesn&rsquo;t exist (it may have been deleted).</p>
      </div>
    );
  }

  const retested = record.retests_test_record_id ? records.find((r) => r.id === record.retests_test_record_id) : null;
  const exercised = record.modes.filter((m) => m.link_type === "exercised");
  const derivedModes = record.modes.filter((m) => m.link_type === "derived");
  const canAddMode = canEdit && (ewGroups?.length ?? 0) > 0 && (sources?.length ?? 0) > 0;
  const versionNumber = versions?.find((v) => v.id === record.emitter_version_id)?.version_number ?? null;

  async function handleDelete() {
    if (!record || !(await confirmDelete(`Delete the test record "${record.title}"?`))) return;
    await del.mutateAsync(record.id);
    navigate(`/emitters/${emitterId}?tab=tests`);
  }

  return (
    <div className="page">
      {backLink}
      <h1>{record.title}</h1>
      <div className="status-row">
        <span className={`test-result-badge test-result-${record.result}`}>{record.result}</span>
        {record.computed_result && (
          <span className="hint-text" title={record.result_note ?? undefined}>
            set by hand (worked out: {record.computed_result})
          </span>
        )}
        <span>{testTypeLabel(record.test_type)}</span>
        <span>tested {record.test_date}</span>
        {record.dwell && <span>dwell {record.dwell}</span>}
        {record.simulation_created_date && (
          <span>
            {record.test_type === "intercept" ? "intercepted" : "simulation created"} {record.simulation_created_date}
          </span>
        )}
        {retested && (
          <span>
            retest of <Link to={`/emitters/${emitterId}/tests/${retested.id}`}>{retested.title}</Link>{" "}
            <span className={`test-result-badge test-result-${retested.result}`}>{retested.result}</span>
          </span>
        )}
      </div>
      {record.computed_result && record.result_note && (
        <p className="result-note">
          <strong>Why the result was changed:</strong> {record.result_note}
        </p>
      )}
      <RequireRole minimum="editor">
        <ResultOverride emitterId={emitterId} record={record} />
      </RequireRole>
      <RunSummary record={record} exercised={exercised} emitterId={emitterId} versionNumber={versionNumber} />
      {record.notes && <p className="muted">{record.notes}</p>}
      {stagedModeFailures && stagedModeFailures.length > 0 && (
        <div className="error-text">
          Run logged, but {stagedModeFailures.length} staged Mode(s) failed to create: {stagedModeFailures.join(", ")}.
          Use &ldquo;+ Add Mode from this test&rdquo; below to retry.
        </div>
      )}

      <RequireRole minimum="editor">
        <div className="form-row">
          {(record.result === "fail" || record.result === "partial") && (
            <Link className="link-as-button" to={`/emitters/${emitterId}/tests/new?retest=${record.id}`}>
              Redo test
            </Link>
          )}
          {canAddMode && (
            <button type="button" className="button secondary small" onClick={() => setAddingMode((v) => !v)}>
              {addingMode ? "Cancel new Mode" : "+ Add Mode from this test"}
            </button>
          )}
          <button type="button" className="link-button link-button-danger" onClick={() => void handleDelete()}>
            Delete this run
          </button>
        </div>
        {addingMode && canAddMode && (
          <div className="card">
            <p className="hint-text">New Mode, linked as derived from &ldquo;{record.title}&rdquo;.</p>
            <ModeForm
              emitterId={emitterId}
              ewGroups={ewGroups ?? []}
              sources={sources ?? []}
              fixedDerivedFromTestRecordId={record.id}
              observedValueOptions={observedValueOptions([
                ...record.lines.map((l) => ({ id: l.test_line_id, name: l.test_line_label, sets: l.observed_values })),
                ...record.modes.map((m) => ({ id: m.mode_id, name: m.mode_name, sets: m.observed_values })),
              ])}
              onClose={() => setAddingMode(false)}
            />
          </div>
        )}
      </RequireRole>

      {record.lines.length > 0 && (
        <div className="card">
          <h4>SIM Test Line results ({record.lines.length})</h4>
          <table className="data-table">
            <thead>
              <tr>
                <th>SIM Test Line</th>
                <th>Outcome</th>
                <th>Intercepted as</th>
                <th>Intercepted parameters</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {record.lines.map((l) => (
                <tr key={l.test_line_id}>
                  <td>{l.test_line_label}</td>
                  <td>
                    <span className={`test-result-badge test-result-${l.outcome}`}>{lineOutcomeLabel(l.outcome)}</span>
                  </td>
                  <td>
                    {l.intercepted_as_unknown || l.intercepted_modes.length
                      ? [...(l.intercepted_as_unknown ? ["Default Unknown"] : []), ...l.intercepted_modes.map((m) => m.mode_name)].join(", ")
                      : "—"}
                  </td>
                  <td>
                    <ObservedValuesTable sets={l.observed_values} />
                  </td>
                  <td className="pre-wrap">{l.notes ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {exercised.length > 0 && (
        <div className="card">
          <h4>Mode results ({exercised.length})</h4>
          <table className="data-table">
            <thead>
              <tr>
                <th>Mode</th>
                <th>Result</th>
                <th>Intercepted parameters</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {exercised.map((m) => (
                <tr key={m.mode_id}>
                  <td>{m.mode_name}</td>
                  <td>{m.result && <span className={`test-result-badge test-result-${m.result}`}>{m.result}</span>}</td>
                  <td>
                    <ObservedValuesTable sets={m.observed_values} />
                  </td>
                  <td className="pre-wrap">{m.notes ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {derivedModes.length > 0 && (
        <div className="card">
          <h4>Modes derived from this run</h4>
          <p>{derivedModes.map((m) => m.mode_name).join(", ")}</p>
        </div>
      )}

      {record.lines.length === 0 && exercised.length === 0 && (
        <p className="hint-text">No per-line or per-Mode results were logged — only the overall result above.</p>
      )}
      {dialog}
    </div>
  );
}

/** Change a logged run's overall result by hand (with why), or put back the
 * one it worked out to. */
function ResultOverride({ emitterId, record }: { emitterId: string; record: TestRecord }) {
  const change = useChangeTestResult(emitterId);
  const [open, setOpen] = useState(false);
  const worked = record.computed_result ?? record.result;
  const [result, setResult] = useState<TestResult>(record.result);
  const [note, setNote] = useState("");
  const needsNote = result !== worked;
  if (!open)
    return (
      <button type="button" className="link-button" onClick={() => setOpen(true)}>
        Change the result
      </button>
    );
  return (
    <div className="result-override-form">
      <label className="inline-date-label">
        Result
        <select value={result} onChange={(e) => setResult(e.target.value as TestResult)}>
          {TEST_RESULTS.map((r) => (
            <option key={r} value={r}>
              {r}
              {r === worked ? " (worked out)" : ""}
            </option>
          ))}
        </select>
      </label>
      {needsNote && (
        <input
          className="result-override-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={`Why it's ${result}, not ${worked} (required)`}
          aria-label="Why the result is changed"
        />
      )}
      <button
        type="button"
        disabled={change.isPending || (needsNote && !note.trim()) || result === record.result}
        onClick={() =>
          change.mutate({ id: record.id, result, note: needsNote ? note.trim() : undefined }, { onSuccess: () => setOpen(false) })
        }
      >
        Save
      </button>
      <button type="button" className="link-button" onClick={() => setOpen(false)}>
        Cancel
      </button>
      {change.isError && <span className="error-text">{(change.error as Error).message}</span>}
    </div>
  );
}
